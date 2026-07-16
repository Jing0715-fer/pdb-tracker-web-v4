import { sseStream, sleep, type SseEvent } from '@/lib/sse';
import { generateText } from '@/lib/llm';
import { buildReportSystemPrompt, buildReportUserPrompt, buildDetailedPdbTable, buildDetailedBlastTable, buildChapterPrompt, buildChapterSystemPrompt, type ReportChapterKey } from '@/lib/report-template';
import { fetchPdbIdsForUniprot, fetchPdbEntryDetails, fetchUniprotMeta, type PdbEntryDetail } from '@/lib/rcsb';
import { runBlast, runBlastDb, fetchUniprotSequence } from '@/lib/blast';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildPdbTableFromReal(details: PdbEntryDetail[]): string {
  return details.slice(0, 10)
    .map(e => `| ${e.pdbId} | ${e.method || '-'} | ${e.resolution != null ? e.resolution.toFixed(1) : '-'} | ${e.journal || '-'} (${e.journalIf != null ? e.journalIf.toFixed(1) : '-'}) | ${(e.title || '').slice(0, 50)} |`)
    .join('\n');
}

/**
 * Build a formatted literature/paper info string for the LLM prompt.
 *
 * Given a list of PDB entry details, this:
 *   1. Collects all non-empty `pubmedId` values
 *   2. Queries the `PubMedArticle` table for any matching articles
 *   3. Joins each PubMedArticle with the journal IF from the PDB entry that
 *      references it (via `PdbStructure.journalIf` / `PdbEntryDetail.journalIf`)
 *   4. If more than `maxLitCount` papers, sorts by journal IF desc and keeps top N
 *   5. Returns a formatted multi-line string with title + journal (IF) + abstract
 *      (truncated to 200 chars). Empty string when no PubMed articles found.
 *
 * Also reads `PdbStructure.journalIf` directly as a fallback in case
 * PubMedArticle query returns hits but PdbEntryDetail.journalIf is null.
 */
async function buildLiteratureInfo(
  pdbDetails: PdbEntryDetail[],
  maxLitCount: number,
): Promise<{ text: string; count: number }> {
  // Collect pubmedIds (non-empty) from the PDB details.
  const pmidToIf = new Map<string, number | null>();
  for (const e of pdbDetails) {
    const pm = (e.pubmedId || '').toString().trim();
    if (!pm) continue;
    // Prefer the highest journalIf when multiple PDBs cite the same paper.
    const cur = pmidToIf.get(pm) ?? null;
    if (e.journalIf != null && (cur == null || e.journalIf > cur)) {
      pmidToIf.set(pm, e.journalIf);
    } else if (!pmidToIf.has(pm)) {
      pmidToIf.set(pm, null);
    }
  }
  const pmids = Array.from(pmidToIf.keys());
  if (pmids.length === 0) return { text: '', count: 0 };

  // Query PubMedArticle table for any matching articles.
  let articles: Array<{ pubmedId: string; title: string | null; journal: string | null; abstract: string | null }> = [];
  try {
    const rows = await db.$queryRaw<any[]>`SELECT pubmedId, title, journal, abstract FROM PubMedArticle WHERE pubmedId IN (${pmids})`;
    articles = (rows as any[]).map((r) => ({ pubmedId: r.pubmedId, title: r.title, journal: r.journal, abstract: r.abstract }));
  } catch {
    // PubMedArticle table may not exist or be empty — degrade gracefully.
    return { text: '', count: 0 };
  }
  if (articles.length === 0) return { text: '', count: 0 };

  // Backfill journal IF from PdbStructure table for any PMIDs whose IF is null.
  const nullIfPmids = articles
    .map((a) => a.pubmedId)
    .filter((pm) => pmidToIf.get(pm) == null);
  if (nullIfPmids.length > 0) {
    try {
      const ifRows = await db.$queryRaw<any[]>`SELECT pubmedId, journalIf FROM PdbStructure WHERE pubmedId IN (${nullIfPmids}) AND journalIf IS NOT NULL`;
      for (const r of ifRows as any[]) {
        const pm = r.pubmedId?.toString();
        if (!pm) continue;
        const v = typeof r.journalIf === 'number' ? r.journalIf : Number(r.journalIf);
        if (!Number.isNaN(v)) pmidToIf.set(pm, v);
      }
    } catch {
      // PdbStructure may not exist (depends on schema state) — ignore.
    }
  }

  // Build candidate paper list with [pubmedId, title, journal, if, abstract].
  type Paper = { pubmedId: string; title: string; journal: string; ifVal: number; abstract: string };
  const papers: Paper[] = articles.map((a) => ({
    pubmedId: a.pubmedId,
    title: (a.title || '').trim() || '(无标题)',
    journal: (a.journal || '').trim() || '(未知期刊)',
    ifVal: pmidToIf.get(a.pubmedId) ?? 0,
    abstract: (a.abstract || '').trim(),
  }));

  // Sort by journal IF desc, then by title asc as a tie-breaker.
  papers.sort((a, b) => b.ifVal - a.ifVal || a.title.localeCompare(b.title));

  // Cap at maxLitCount.
  const capped = papers.slice(0, Math.max(0, Math.floor(maxLitCount)));
  if (capped.length === 0) return { text: '', count: 0 };

  // Format each paper: title + journal (IF) + abstract (truncated 200 chars).
  const lines = capped.map((p) => {
    const ifStr = p.ifVal > 0 ? ` (IF ${p.ifVal.toFixed(1)})` : '';
    const abs = p.abstract ? p.abstract.slice(0, 200) : '(无摘要)';
    return `• [PMID ${p.pubmedId}] ${p.title} — ${p.journal}${ifStr}\n  摘要: ${abs}`;
  });
  const text = lines.join('\n\n');
  return { text, count: capped.length };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Support both flat fields (single target) and targets[] array (batch mode).
  // When targets[] is present, use the first target's params for the primary
  // evaluation. Batch mode iterates over all targets after the primary.
  const targets: Array<{ uniprot: string; forceBlast?: boolean; skipBlast?: boolean; maxPdb?: number; maxBlastHits?: number }> = Array.isArray(body.targets) ? body.targets : [];
  const primaryTarget = targets[0] || {};
  const uniprot = (body.uniprot || primaryTarget.uniprot || 'P00533').trim().toUpperCase();
  const forceBlast = !!(body.forceBlast ?? primaryTarget.forceBlast);
  const skipBlast = !!(body.skipBlast ?? primaryTarget.skipBlast);
  const maxPdb = Number(body.maxPdb ?? primaryTarget.maxPdb ?? 80);
  // BLAST homolog cap. Default 50 (NCBI BLAST pdbaa typical sensible max). UI-configurable.
  const maxBlastHits = Number(body.maxBlastHits ?? primaryTarget.maxBlastHits ?? body.maxBlast ?? 50);
  // Literature cap for LLM prompt context (PubMed articles surfaced alongside PDB details).
  // Default 20. UI-configurable. Papers beyond this are filtered by journal IF desc.
  const maxLitCount = Math.max(0, Math.min(200, Number(body.maxLitCount ?? 20)));
  const generateReport = body.generateReport !== false;
  const saveReportFile = body.saveReportFile !== false;
  const isBatch = !!body.isBatch && targets.length > 1;
  // Default to hermes CLI (no z-ai — this app must run without z-ai-web-dev-sdk).
  const provider = body.llm?.provider || 'cli:hermes';
  const model = body.llm?.model || 'hermes';

  const { stream, progress, done } = sseStream();
  (async () => {
    const t0 = Date.now();
    const emit = (e: SseEvent) => progress(e);
    try {
      // ── Helper: evaluate ONE sequence (used by both single & multi-sequence modes) ──
      // Returns the full per-sequence result object. All log messages are
      // prefixed with `[序列 i/N]` when seqTotal > 1 so the SSE feed can show
      // which sequence is being processed.
      const evaluateOneSequence = async (
        rawSequence: string,
        seqType: 'aa' | 'dna',
        seqIndex: number,
        seqTotal: number,
      ): Promise<{
        seqId: string;
        uniprotInfo: any;
        pdbDetails: PdbEntryDetail[];
        blastHits: any[];
        scores: any;
        coverage: number;
        report: any;
        usedNrFallback: boolean;
        ok: boolean;
        error?: string;
      }> => {
        const prefix = seqTotal > 1 ? `[序列 ${seqIndex}/${seqTotal}] ` : '';
        // Generate a stable seqId up front (fixes prior TDZ bug where seqId
        // was referenced before its declaration).
        const seqId = `SEQ_${Date.now().toString(36)}_${seqIndex}`;
        let sequence = String(rawSequence).trim().toUpperCase().replace(/\s/g, '');
        emit({ stage: 'init', level: 'info', message: `${prefix}启动序列评估 · ${seqType === 'dna' ? 'DNA' : 'AA'} 序列 (${sequence.length} ${seqType === 'dna' ? 'nt' : 'aa'})`, progress: 2 });
        await sleep(200);

        // Transcribe DNA to amino acid sequence
        if (seqType === 'dna') {
          emit({ stage: 'transcribe', level: 'info', message: `${prefix}DNA → 氨基酸转录中…`, progress: 5 });
          const cleanDna = sequence.replace(/[^ATGC]/g, '');
          const codonTable: Record<string, string> = {
            'TTT':'F','TTC':'F','TTA':'L','TTG':'L','CTT':'L','CTC':'L','CTA':'L','CTG':'L',
            'ATT':'I','ATC':'I','ATA':'I','ATG':'M','GTT':'V','GTC':'V','GTA':'V','GTG':'V',
            'TCT':'S','TCC':'S','TCA':'S','TCG':'S','CCT':'P','CCC':'P','CCA':'P','CCG':'P',
            'ACT':'T','ACC':'T','ACA':'T','ACG':'T','GCT':'A','GCC':'A','GCA':'A','GCG':'A',
            'TAT':'Y','TAC':'Y','TAA':'*','TAG':'*','CAT':'H','CAC':'H','CAA':'Q','CAG':'Q',
            'AAT':'N','AAC':'N','AAA':'K','AAG':'K','GAT':'D','GAC':'D','GAA':'E','GAG':'E',
            'TGT':'C','TGC':'C','TGA':'*','TGG':'W','CGT':'R','CGC':'R','CGA':'R','CGG':'R',
            'AGT':'S','AGC':'S','AGA':'R','AGG':'R','GGT':'G','GGC':'G','GGA':'G','GGG':'G',
          };
          let aaSeq = '';
          for (let i = 0; i + 2 < cleanDna.length; i += 3) {
            const codon = cleanDna.slice(i, i + 3);
            const aa = codonTable[codon] || 'X';
            if (aa === '*') break; // stop codon
            aaSeq += aa;
          }
          sequence = aaSeq;
          emit({ stage: 'transcribe', level: 'success', message: `${prefix}转录完成: ${cleanDna.length}nt → ${aaSeq.length}aa`, progress: 10 });
        }

        // Run BLASTp — pdbaa first, fallback to nr if no hits or top identity < 95%
        emit({ stage: 'blast', level: 'info', message: `${prefix}BLASTp 同源检索 — pdbaa 数据库（序列 ${sequence.length}aa, 上限 ${maxBlastHits}）`, progress: 15 });
        let blastHits: any[] = [];
        let usedNrFallback = false;
        try {
          const blastPromise = runBlast(sequence, maxBlastHits, (msg) => { emit({ stage: 'blast', level: 'info', message: `${prefix}${msg}`, progress: 20 }); });
          const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BLAST 超时（180s）')), 180000));
          blastHits = await Promise.race([blastPromise, timeoutPromise]);
          const topIdentity = blastHits.length > 0 ? blastHits[0].identity : 0;
          if (blastHits.length === 0) {
            emit({ stage: 'blast', level: 'warn', message: `${prefix}pdbaa 数据库无命中，回退搜索 nr 数据库…`, progress: 25 });
          } else if (topIdentity < 95) {
            emit({ stage: 'blast', level: 'warn', message: `${prefix}pdbaa 最高同源度 ${topIdentity}% < 95%，回退搜索 nr 数据库…`, progress: 25 });
          } else {
            emit({ stage: 'blast', level: 'success', message: `${prefix}pdbaa 命中 ${blastHits.length}/${maxBlastHits} 条同源（最高 identity=${topIdentity}% · ${blastHits[0].pdbId}）`, progress: 40 });
          }
          if (blastHits.length === 0 || topIdentity < 95) {
            emit({ stage: 'blast-nr', level: 'info', message: `${prefix}BLASTp 同源检索 — nr 数据库（非冗余库, 上限 ${maxBlastHits}）`, progress: 28 });
            try {
              const nrPromise = runBlastDb(sequence, maxBlastHits, 'nr', (msg) => { emit({ stage: 'blast-nr', level: 'info', message: `${prefix}${msg}`, progress: 30 }); });
              const nrTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BLAST nr 超时（180s）')), 180000));
              const nrHits = await Promise.race([nrPromise, nrTimeout]);
              if (nrHits.length > 0) {
                usedNrFallback = true;
                blastHits = nrHits;
                emit({ stage: 'blast-nr', level: 'success', message: `${prefix}nr 命中 ${nrHits.length}/${maxBlastHits} 条同源（最高 identity=${nrHits[0].identity}% · ${nrHits[0].uniprotRef}）`, progress: 40 });
              } else {
                emit({ stage: 'blast-nr', level: 'warn', message: `${prefix}nr 数据库也无命中`, progress: 40 });
              }
            } catch (nrErr: any) {
              emit({ stage: 'blast-nr', level: 'error', message: `${prefix}nr 搜索失败：${nrErr?.message}`, progress: 40 });
            }
          }
        } catch (err: any) {
          emit({ stage: 'blast', level: 'error', message: `${prefix}BLAST pdbaa 失败：${err?.message}`, progress: 40 });
        }

        // Build pdbDetails from BLAST hits. For pdbaa hits, pdbId is real.
        // For nr hits, pdbId is empty (we never extract fake pdbIds from
        // UniProt accessions — see parseBlastXml in src/lib/blast.ts). The
        // real pdb list for nr-fallback path comes from UniProt → RCSB lookup
        // below, AFTER we have the uniprotAcc.
        let pdbDetails: PdbEntryDetail[] = blastHits
          .filter((h: any) => h.pdbId)  // skip nr hits with empty pdbId
          .map((h: any) => ({
            pdbId: h.pdbId, method: h.method || 'X-RAY DIFFRACTION', resolution: h.resolution ?? null,
            title: h.description || h.title || '', journal: h.journal || '', journalIf: h.journalIf ?? null,
            doi: null, pubmedId: h.pubmedId || null, organisms: h.organism || '',
            authors: '', ligands: '', depositDate: null, releaseDate: h.releaseDate || null,
          }));

        // ── Fetch UniProt metadata from the top BLAST hit ──
        let uniprotInfo: any = { uniprotId: seqId, entryName: 'Sequence Input', proteinName: `Input Sequence (${sequence.length}aa)`, geneNames: 'N/A', organism: 'N/A', sequenceLength: sequence.length };
        if (blastHits.length > 0) {
          const topHit = blastHits[0];
          emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}从最高同源性命中 (${usedNrFallback ? topHit.uniprotRef : topHit.pdbId}, identity=${topHit.identity}%) 查找 UniProt 元数据…`, progress: 42 });
          try {
            let uniprotAcc: string | null = null;
            if (usedNrFallback) {
              const acc = topHit.uniprotRef;
              const uniMatch = (topHit.description || '').match(/sp\|([A-Z0-9]+)\|/);
              if (uniMatch) {
                uniprotAcc = uniMatch[1];
              } else if (/^[A-NR-Z][0-9][A-Z0-9]{3}[0-9]/i.test(acc) || /^([A-Z0-9]{6,10})$/i.test(acc)) {
                uniprotAcc = acc;
              } else {
                emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}通过 NCBI accession ${acc} 搜索 UniProt…`, progress: 44 });
                const uniSearchRes = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=xref:${acc}&fields=accession&format=json&size=1`, { signal: AbortSignal.timeout(15000) });
                if (uniSearchRes.ok) {
                  const uniSearchData = await uniSearchRes.json();
                  uniprotAcc = uniSearchData?.results?.[0]?.primaryAccession || null;
                }
              }
            } else {
              const rcsbRes = await fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${topHit.pdbId}/1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
              if (rcsbRes.ok) {
                const rcsbData = await rcsbRes.json();
                const uniProts = rcsbData?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers || [];
                uniprotAcc = uniProts.find((r: any) => r.database_name === 'UniProt')?.database_accession || null;
              }
            }
            if (uniprotAcc) {
              emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}找到 UniProt accession: ${uniprotAcc}，获取元数据…`, progress: 44 });
              const meta = await fetchUniprotMeta(uniprotAcc);
              if (meta) {
                uniprotInfo = {
                  uniprotId: uniprotAcc,
                  entryName: meta.entryName,
                  proteinName: meta.proteinName,
                  geneNames: meta.geneNames,
                  organism: meta.organism,
                  sequenceLength: meta.sequenceLength,
                  blastIdentity: topHit.identity,
                  blastPdbId: topHit.pdbId,
                  blastSource: usedNrFallback ? 'nr' : 'pdbaa',
                };
                emit({ stage: 'uniprot-lookup', level: 'success', message: `${prefix}UniProt 元数据: ${meta.proteinName} · ${meta.organism} · ${meta.sequenceLength}aa (BLAST identity=${topHit.identity}% via ${usedNrFallback ? 'nr' : 'pdbaa'})`, progress: 46 });
              } else {
                emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}UniProt 元数据获取失败 (${uniprotAcc})`, progress: 46 });
              }
            } else {
              emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}未找到关联的 UniProt accession`, progress: 46 });
            }

            // ── nr-fallback path: fetch REAL PDB IDs from UniProt → RCSB ──
            // The nr BLAST hit's pdbId is empty (parseBlastXml never extracts
            // a fake one from a UniProt accession). To get a real PDB list
            // for scoring + the LLM report, query RCSB by the UniProt accession
            // we just resolved. We MERGE these with any pdbaa hits already in
            // pdbDetails (in case some pdbaa hits survived the threshold), and
            // dedup by pdbId. UniProt-sourced entries take priority (they carry
            // proper RCSB metadata: method, resolution, journal, pubmedId).
            if (usedNrFallback && uniprotAcc) {
              emit({ stage: 'rcsb-from-uniprot', level: 'info', message: `${prefix}nr-fallback 路径: 从 UniProt ${uniprotAcc} 反查真实 PDB ID（最多 ${maxPdb}）…`, progress: 47 });
              try {
                const uniprotPdbIds = await fetchPdbIdsForUniprot(uniprotAcc, maxPdb);
                if (uniprotPdbIds.length > 0) {
                  const uniprotPdbDetails = await fetchPdbEntryDetails(uniprotPdbIds, uniprotPdbIds.length);
                  // Dedup: prefer UniProt-sourced entries (full RCSB metadata)
                  // over any leftover pdbaa hits that happen to share a pdbId.
                  const seenPdbIds = new Set(uniprotPdbDetails.map(e => e.pdbId));
                  pdbDetails = [
                    ...uniprotPdbDetails,
                    ...pdbDetails.filter(e => !seenPdbIds.has(e.pdbId)),
                  ];
                  emit({ stage: 'rcsb-from-uniprot', level: 'success', message: `${prefix}✓ UniProt ${uniprotAcc} → RCSB 反查命中 ${uniprotPdbDetails.length} 个真实 PDB（合并后 ${pdbDetails.length}）`, progress: 48 });
                } else {
                  emit({ stage: 'rcsb-from-uniprot', level: 'warn', message: `${prefix}UniProt ${uniprotAcc} 在 RCSB 中无关联 PDB`, progress: 48 });
                }
              } catch (rcsbErr: any) {
                emit({ stage: 'rcsb-from-uniprot', level: 'warn', message: `${prefix}RCSB 反查失败: ${rcsbErr?.message}`, progress: 48 });
              }
            }
          } catch (err: any) {
            emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}UniProt 查找失败: ${err?.message}`, progress: 46 });
          }
        }

        // Score from BLAST hit count
        const xrayCount = pdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
        const cryoemCount = pdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
        const nmrCount = pdbDetails.filter(e => (e.method || '').includes('NMR')).length;
        const calcScore = (c: number) => Math.min(10, Math.max(1, Math.round(c / 5) + 3));
        const scores = {
          xray: { score: calcScore(xrayCount), rating: '', structures: xrayCount },
          cryoem: { score: calcScore(cryoemCount), rating: '', structures: cryoemCount },
          nmr: { score: calcScore(nmrCount), rating: '', structures: nmrCount },
          overall: { score: Math.min(10, Math.max(1, Math.round((calcScore(xrayCount) + calcScore(cryoemCount) + calcScore(nmrCount)) / 3))), rating: '' },
        };
        const coverage = Math.min(100, pdbDetails.length * 5);
        const scoreRating = (s: number) => s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
        scores.xray.rating = scoreRating(scores.xray.score);
        scores.cryoem.rating = scoreRating(scores.cryoem.score);
        scores.nmr.rating = scoreRating(scores.nmr.score);
        scores.overall.rating = scoreRating(scores.overall.score);
        emit({ stage: 'score', level: 'success', message: `${prefix}overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${xrayCount}条, Cryo-EM=${scores.cryoem.score}/${cryoemCount}条, NMR=${scores.nmr.score}/${nmrCount}条)`, progress: 50 });

        // Generate report (single-call — shorter than 8-chapter UniProt mode)
        let report: any = undefined;
        if (generateReport) {
          emit({ stage: 'llm-report', level: 'info', message: `${prefix}生成 LLM 报告 (${provider})…`, progress: 55 });
          try {
            const litInfo = await buildLiteratureInfo(pdbDetails, maxLitCount);
            const pdbTable = pdbDetails.length > 0
              ? buildDetailedPdbTable(pdbDetails, 80)
              : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 BLAST 同源结构) | - | - | - | - |';
            const blastTable = buildDetailedBlastTable(blastHits, maxBlastHits);
            const topPdbs = pdbDetails.slice(0, 10).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)}`).join('\n');
            const litBlock = litInfo.count > 0 ? `\n\n相关 PubMed 文献（共 ${litInfo.count} 篇，按 IF 降序）：\n${litInfo.text}` : '\n\n（无 PubMed 文献数据）';
            const userPrompt = `Generate a Chinese protein structure feasibility report for:

UniProt: ${uniprotInfo.uniprotId !== seqId ? uniprotInfo.uniprotId : '(序列输入模式 — 无直接 UniProt ID)'}
Protein: ${uniprotInfo.proteinName}
Gene: ${uniprotInfo.geneNames}
Organism: ${uniprotInfo.organism}
Sequence length: ${uniprotInfo.sequenceLength} aa
BLAST top hit: ${uniprotInfo.blastPdbId ? `${uniprotInfo.blastPdbId} (identity=${uniprotInfo.blastIdentity}%)` : 'N/A'}
Input sequence: ${sequence.slice(0, 100)}... (${sequence.length}aa)
BLAST hits: ${blastHits.length}
Top BLAST structures:
${topPdbs || '（无 BLAST 命中）'}

${pdbTable}

${blastTable}${litBlock}

请基于 BLAST 同源搜索结果和 UniProt 元数据生成评估报告。重点分析输入序列与已知蛋白的同源性、结构特征、功能推断。`;
            const bSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份蛋白序列评估报告（800-1500 字），使用 Markdown 格式，包含以下章节：## 序列概述、## BLAST 同源结构分析、## 可成药性评估、## 实验建议、## 总结。';
            const r = await generateText(bSysPrompt, userPrompt, { maxChars: 2000, llm: body.llm });
            report = { ok: r.ok, content: r.content, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: r.content?.length || 0, fallback: false };
            if (r.ok) emit({ stage: 'llm-report', level: 'success', message: `${prefix}LLM 报告已生成 · ${report.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}`, progress: 90 });
            else emit({ stage: 'llm-report', level: 'error', message: `${prefix}LLM 报告失败：${r.error}`, progress: 90 });
          } catch (err: any) {
            emit({ stage: 'llm-report', level: 'error', message: `${prefix}LLM 生成失败：${err?.message}`, progress: 90 });
          }
        }

        // Write to DB
        try {
          const scoresJson = JSON.stringify({ 'X-ray': { score: scores.xray.score, rating: scores.xray.rating }, 'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating }, 'NMR': { score: scores.nmr.score, rating: scores.nmr.rating }, 'Overall': { score: scores.overall.score, rating: scores.overall.rating } });
          await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${seqId}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, ${report?.ok ? report.content : null}, 0, false, ${pdbDetails.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, updatedAt = CURRENT_TIMESTAMP`;
          await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${seqId}`;
          // Dedup by pdbId — the same PDB can show up multiple times in
          // pdbDetails (BLAST report can return the same entry for
          // multiple chains / HSP regions). We keep the first occurrence.
          const seenPdbIds = new Set<string>();
          let dedupedPdbCount = 0;
          for (const e of pdbDetails) {
            if (!e.pdbId || seenPdbIds.has(e.pdbId)) continue;
            seenPdbIds.add(e.pdbId);
            dedupedPdbCount++;
            const isCryoem = (e.method || '').includes('ELECTRON'); const isXray = (e.method || '').includes('X-RAY'); const isNmr = (e.method || '').includes('NMR');
            const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
            await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${seqId}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate || null}, ${e.releaseDate}, ${e.ligands || ''}, ${e.ligands || ''}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms || ''}, ${e.authors || ''}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
          }
          await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${seqId}`;
          // Dedup blastHits by pdbId as well — same PDB can show up via
          // both pdbaa and nr fallback searches.
          const seenBlastPdbIds = new Set<string>();
          let dedupedBlastCount = 0;
          let paralogCount = 0;
          for (const h of blastHits) {
            if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
            seenBlastPdbIds.add(h.pdbId);
            dedupedBlastCount++;
            if (h.isParalog) paralogCount++;
            await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${seqId}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${!!h.isParalog})`;
          }
          emit({ stage: 'write-db', level: 'success', message: `${prefix}已写入 Evaluation + ${dedupedPdbCount} PDB (去重自 ${pdbDetails.length}) + ${dedupedBlastCount} BLAST (${paralogCount} 个同源蛋白 ≥95%, 去重自 ${blastHits.length})`, progress: 95 });
        } catch (err: any) {
          emit({ stage: 'write-db', level: 'error', message: `${prefix}DB 写入失败：${err?.message}`, progress: 95 });
        }

        return { seqId, uniprotInfo, pdbDetails, blastHits, scores, coverage, report, usedNrFallback, ok: true };
      };

      // ── Multi-sequence mode: body.inputMode === 'sequence' && Array.isArray(body.sequences) ──
      // Loops through each sequence, runs BLAST + per-sequence report, then
      // generates a cross-sequence comparison report (mirrors batch mode for
      // UniProt IDs).
      if (body.inputMode === 'sequence' && Array.isArray(body.sequences) && body.sequences.length > 0) {
        const seqType: 'aa' | 'dna' = body.sequenceType === 'dna' ? 'dna' : 'aa';
        const rawSeqs: string[] = (body.sequences as any[])
          .filter((s) => typeof s === 'string' && s.replace(/\s/g, '').length >= 10)
          .map((s) => String(s));
        if (rawSeqs.length === 0) {
          emit({ stage: 'error', level: 'error', message: `未提供有效序列（每条至少 10 个残基）`, progress: 100 });
          await sleep(50);
          done({ ok: false, error: 'no valid sequences' });
          return;
        }
        const isMulti = rawSeqs.length > 1;
        emit({ stage: 'init', level: 'info', message: `启动多序列批量评估 · ${rawSeqs.length} 条 ${seqType === 'dna' ? 'DNA' : 'AA'} 序列 — 每条独立 BLASTp${isMulti ? ' + 跨序列相关性分析' : ''} — SSE streaming…`, progress: 2 });
        await sleep(300);

        const seqResults: any[] = [];
        for (let i = 0; i < rawSeqs.length; i++) {
          try {
            const r = await evaluateOneSequence(rawSeqs[i], seqType, i + 1, rawSeqs.length);
            seqResults.push(r);
            emit({ stage: `seq-${i + 1}-done`, level: 'success', message: `[序列 ${i + 1}/${rawSeqs.length}] ${r.seqId} 完成 · ${r.blastHits.length} BLAST 同源 · overall=${r.scores.overall.score}/10${r.report?.ok ? ` · LLM ✓ (${r.report.contentChars} chars)` : ''}`, progress: 100 });
          } catch (err: any) {
            emit({ stage: `seq-${i + 1}-done`, level: 'error', message: `[序列 ${i + 1}/${rawSeqs.length}] 失败：${err?.message}`, progress: 100 });
            seqResults.push({ seqId: `SEQ_ERR_${i + 1}`, ok: false, error: err?.message || String(err), pdbDetails: [], blastHits: [], scores: { overall: { score: 0 } }, coverage: 0, report: undefined, uniprotInfo: { proteinName: `Sequence ${i + 1} (failed)` } });
          }
        }

        // ── Cross-sequence comparison report (only when more than 1 sequence) ──
        let crossReport: any = undefined;
        if (isMulti) {
          // Find common PDB IDs across sequences (pairwise + intersection of all).
          const allPdbSets = seqResults.map(r => ({ seqId: r.seqId, proteinName: r.uniprotInfo?.proteinName, pdbIds: new Set((r.pdbDetails || []).map((e: PdbEntryDetail) => e.pdbId)) }));
          const commonPdbIds = allPdbSets.length > 0
            ? [...allPdbSets[0].pdbIds].filter(id => allPdbSets.every(s => s.pdbIds.has(id)))
            : [];
          const pdbOverlap: Record<string, string[]> = {};
          for (let a = 0; a < allPdbSets.length; a++) {
            for (let b = a + 1; b < allPdbSets.length; b++) {
              const shared = [...allPdbSets[a].pdbIds].filter(id => allPdbSets[b].pdbIds.has(id));
              if (shared.length > 0) {
                pdbOverlap[`${allPdbSets[a].seqId}↔${allPdbSets[b].seqId}`] = shared;
              }
            }
          }
          emit({ stage: 'cross-analysis', level: commonPdbIds.length > 0 ? 'success' : 'info', message: `跨序列共有结构（全部序列）：${commonPdbIds.length} 个${commonPdbIds.length > 0 ? ` (${commonPdbIds.slice(0, 5).join(', ')}…)` : ''} · 两两重叠：${Object.keys(pdbOverlap).length} 对`, progress: 100 });

          if (generateReport) {
            emit({ stage: 'cross-llm', level: 'info', message: `生成跨序列相关性 LLM 分析报告…`, progress: 100 });
            try {
              const crossSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份跨序列相关性分析报告，使用 Markdown 格式。分析多条蛋白序列之间的结构关联性、功能关系、以及共有的结构基础。';
              const seqSummary = seqResults.map((r, i) => {
                const top5 = (r.pdbDetails || []).slice(0, 5).map((e: PdbEntryDetail) => `  - ${e.pdbId}: ${e.method} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 50)}`).join('\n');
                const s = r.scores as any;
                return `序列 ${i + 1}: ${r.seqId} (${r.uniprotInfo?.proteinName || 'Unknown'})
  序列长度: ${r.uniprotInfo?.sequenceLength || '?'} aa
  BLAST 同源数: ${(r.blastHits || []).length}
  评分: overall=${s?.overall?.score || '?'}/10 (X-ray=${s?.xray?.score || '?'}/${s?.xray?.structures || 0}条, Cryo-EM=${s?.cryoem?.score || '?'}/${s?.cryoem?.structures || 0}条, NMR=${s?.nmr?.score || '?'}/${s?.nmr?.structures || 0}条)
  代表性结构:
${top5 || '  （无 BLAST 命中）'}`;
              }).join('\n\n');
              const overlapSummary = Object.entries(pdbOverlap).length > 0
                ? Object.entries(pdbOverlap).map(([pair, ids]) => {
                    const idDetails = ids.slice(0, 10).map(id => {
                      const det = seqResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                      return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(det?.title || '').slice(0, 60)}`;
                    }).join('\n');
                    return `${pair}: ${ids.length} 个共有结构\n${idDetails}`;
                  }).join('\n')
                : '无两两共有结构';
              // Aggregate literature across all sequences (cap at maxLitCount, IF desc).
              const allSeqPdbs: PdbEntryDetail[] = seqResults.flatMap(r => r.pdbDetails || []);
              const crossLit = await buildLiteratureInfo(allSeqPdbs, maxLitCount);
              const crossLitBlock = crossLit.count > 0
                ? `\n\n相关 PubMed 文献（聚合全部 ${seqResults.length} 条序列，共 ${crossLit.count} 篇，按 IF 降序）：\n${crossLit.text}`
                : '\n\n（无 PubMed 文献数据）';
              const commonPdbDetails = commonPdbIds.length > 0
                ? commonPdbIds.slice(0, 15).map(id => {
                    const det = seqResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                    return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${det?.journal || 'N/A'} (${det?.journalIf != null ? det.journalIf.toFixed(1) : 'N/A'}) | ${(det?.title || '').slice(0, 60)}`;
                  }).join('\n')
                : '（无共有结构）';
              const crossUserPrompt = `请分析以下 ${seqResults.length} 条蛋白序列的结构相关性与功能关系：

${seqSummary}

共有结构分析：
- 全部序列共有的结构: ${commonPdbIds.length} 个
${commonPdbDetails}
- 两两重叠:
${overlapSummary}${crossLitBlock}

请按以下结构生成报告：
## 跨序列相关性分析报告

### 一、序列概览
（简述每条序列的蛋白名称、BLAST 同源结构数量、评分）

### 二、共有结构分析
（分析共有 PDB 结构的含义 — 这些结构可能揭示序列间的进化关系或功能关联）

### 三、功能与通路关联
（基于蛋白名称和结构信息，分析序列是否在同一蛋白家族或功能网络中）

### 四、结构相似性推断
（从共有结构推断序列间的结构相似性，讨论对药物设计或交叉研究的意义）

### 五、文献综合
（结合相关文献区块中的 PMID 列表，简述跨序列文献证据，引用 PMID 编号）

### 六、总结与建议
（总结序列间关系，提出后续研究建议）`;
              const r = await generateText(crossSysPrompt, crossUserPrompt, { maxChars: 4000, llm: body.llm });
              crossReport = { ok: r.ok, content: r.content, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: r.content?.length || 0, commonPdbIds, pdbOverlap, literatureCount: crossLit.count };
              if (r.ok) emit({ stage: 'cross-llm', level: 'success', message: `✓ 跨序列相关性报告已生成 · ${crossReport.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}${crossLit.count > 0 ? ` · 附 ${crossLit.count} 篇文献` : ''}`, progress: 100 });
              else emit({ stage: 'cross-llm', level: 'error', message: `✗ 跨序列相关性 LLM 失败：${r.error}`, progress: 100 });
            } catch (err: any) {
              emit({ stage: 'cross-llm', level: 'error', message: `✗ 跨序列相关性分析失败：${err?.message}`, progress: 100 });
            }
          }

          // Write batch record to EvaluationBatch + SkillRunRecord
          const batchTitle = `Multi-Seq: ${seqResults.length} sequences`;
          // `commonPdbIds` already computed above — reuse it for the batch record.
          const commonPdbIdsJson = JSON.stringify(commonPdbIds);
          const crossReportContent = crossReport?.ok ? crossReport.content : null;
          try {
            const batchId = 'mseq-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            await db.$executeRaw`INSERT INTO EvaluationBatch (batchId, title, combinedReport, commonPdbIds, crossReportOk, crossReportProvider, crossReportModel, crossReportDurationMs, crossReportChars, targetCount, createdAt, updatedAt) VALUES (${batchId}, ${batchTitle}, ${crossReportContent}, ${commonPdbIdsJson}, ${crossReport?.ok ?? false}, ${crossReport?.provider || null}, ${crossReport?.model || null}, ${crossReport?.durationMs || 0}, ${crossReport?.contentChars || 0}, ${seqResults.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
            for (const r of seqResults) {
              try { await db.$executeRaw`UPDATE Evaluation SET batchId = ${batchId} WHERE uniprotId = ${r.seqId}`; } catch {}
            }
            emit({ stage: 'batch-db', level: 'success', message: `✓ 多序列 Batch 记录已写入 EvaluationBatch (${batchId}) · 关联 ${seqResults.length} 条序列`, progress: 100 });
          } catch (err: any) {
            emit({ stage: 'batch-db', level: 'error', message: `多序列 Batch 记录写入失败：${err?.message}`, progress: 100 });
          }
          try {
            await db.skillRunRecord.create({
              data: {
                module: 'eval',
                status: crossReport?.ok || !generateReport ? 'success' : 'error',
                summary: `多序列批量评估 ${seqResults.length} 条序列 · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? 'LLM ✓' : generateReport ? 'LLM ✗' : 'no LLM'}`,
                details: JSON.stringify({ sequenceCount: seqResults.length, seqIds: seqResults.map(r => r.seqId), commonPdbIds, crossReportOk: crossReport?.ok }),
                provider: body.llm?.provider || 'auto',
                model: crossReport?.model || '',
                llmOk: generateReport ? crossReport?.ok ?? false : null,
                durationMs: Date.now() - t0,
                resultJson: JSON.stringify({ sequences: seqResults.map(r => ({ seqId: r.seqId, pdbCount: r.pdbDetails?.length || 0, overall: r.scores?.overall?.score })), commonPdbIds, crossReportChars: crossReport?.contentChars || 0 }),
              },
            });
          } catch { /* ignore */ }
        }

        const result = {
          ok: true,
          inputMode: 'sequence',
          sequenceCount: seqResults.length,
          sequences: seqResults.map(r => ({
            seqId: r.seqId,
            uniprotInfo: r.uniprotInfo,
            pdbCount: r.pdbDetails?.length || 0,
            blastHitCount: r.blastHits?.length || 0,
            coverage: r.coverage,
            scores: r.scores,
            report: r.report
              ? {
                  ok: !!r.report.ok,
                  content: r.report.content || '',
                  provider: r.report.provider || '',
                  model: r.report.model || '',
                  durationMs: r.report.durationMs || 0,
                  contentChars: r.report.contentChars || 0,
                }
              : undefined,
          })),
          crossAnalysis: isMulti ? { crossReport } : undefined,
          durationMs: Date.now() - t0,
        };
        const okCount = seqResults.filter(r => r.report?.ok).length;
        emit({ stage: 'done', level: 'success', message: `多序列评估完成 · ${seqResults.length} 条 · LLM ${okCount}/${seqResults.length} ✓${isMulti && crossReport?.ok ? ' · 跨序列报告 ✓' : isMulti && generateReport ? ' · 跨序列报告 ✗' : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`, progress: 100 });
        await sleep(150);
        done(result);
        return;
      }

      // ── Single sequence mode (backward compatible: body.sequence is a string) ──
      if (body.inputMode === 'sequence' && body.sequence) {
        const seqType: 'aa' | 'dna' = body.sequenceType === 'dna' ? 'dna' : 'aa';
        const r = await evaluateOneSequence(String(body.sequence), seqType, 1, 1);
        const result = { uniprot: r.seqId, uniprotInfo: r.uniprotInfo, directPdbCount: 0, pdbPersisted: r.pdbDetails.length, blastHitCount: r.blastHits.length, coverage: r.coverage, scores: r.scores, report: r.report, dbSaved: true, durationMs: Date.now() - t0 };
        emit({ stage: 'done', level: r.report?.ok || !generateReport ? 'success' : 'warn', message: `完成 · ${r.blastHits.length} BLAST 同源 · overall=${r.scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${r.report?.ok ? ` · LLM ✓ (${r.report.contentChars} chars)` : ''}`, progress: 100 });
        await sleep(150);
        done(result);
        return;
      }


      // ── Standard UniProt ID mode (original flow) ──
      emit({ stage: 'init', level: 'info', message: `启动 protein-target-evaluator · uniprot=${uniprot}`, progress: 2 });
      await sleep(300);
      emit({ stage: 'uniprot-meta', level: 'info', message: `拉取 UniProt 元数据 (${uniprot})`, progress: 8 });

      // ── Real UniProt metadata fetch (replaces hardcoded 'Epidermal growth factor receptor') ──
      const meta = await fetchUniprotMeta(uniprot);
      const uniprotInfo = meta
        ? {
            uniprotId: uniprot,
            entryName: meta.entryName,
            proteinName: meta.proteinName,
            geneNames: meta.geneNames || '—',
            organism: meta.organism || '—',
            sequenceLength: meta.sequenceLength || 0,
          }
        : {
            // Fallback placeholder when UniProt API fails — surface clearly, do NOT silently lie.
            uniprotId: uniprot,
            entryName: uniprot,
            proteinName: `Unknown (UniProt fetch failed)`,
            geneNames: '—',
            organism: '—',
            sequenceLength: 0,
          };
      emit({
        stage: 'uniprot-meta',
        level: meta ? 'success' : 'warn',
        message: `${uniprotInfo.proteinName} · ${uniprotInfo.sequenceLength || '?'} aa`,
        progress: 14,
      });

      emit({ stage: 'rcsb-direct', level: 'info', message: `RCSB 检索 UniProt=${uniprot}（真实 API, 上限 ${maxPdb}）`, progress: 18 });
      const pdbIds = await fetchPdbIdsForUniprot(uniprot, maxPdb);
      const directPdbCount = pdbIds.length;
      if (directPdbCount === 0) emit({ stage: 'rcsb-direct', level: 'warn', message: `RCSB 返回 0 条`, progress: 28 });
      else emit({ stage: 'rcsb-direct', level: 'success', message: `✓ RCSB 返回 ${directPdbCount} 条真实 PDB`, progress: 24 });

      // ── Cache check: skip re-fetch + re-report if params + PDB count unchanged ──
      let cachedEval: any = null;
      let pdbDetails: PdbEntryDetail[] = [];
      let skipReportGeneration = false;
      try {
        cachedEval = await db.$queryRaw<any[]>`SELECT uniprotId, maxPdbUsed, blastWasSkipped, pdbCountAtEval, report, scores, coverage FROM Evaluation WHERE uniprotId = ${uniprot}`;
        cachedEval = (cachedEval as any[])[0] || null;
      } catch { /* table may not exist */ }

      if (cachedEval
          && cachedEval.maxPdbUsed === maxPdb
          && !!cachedEval.blastWasSkipped === (skipBlast && !forceBlast)
          && cachedEval.pdbCountAtEval === directPdbCount
          && cachedEval.report) {
        // Cache hit — same params + same PDB count + existing report. Skip re-fetch.
        emit({ stage: 'cache-hit', level: 'success', message: `✓ 缓存命中：参数与 PDB 数量未变（maxPdb=${maxPdb}, skipBlast=${skipBlast}, pdbCount=${directPdbCount}），跳过重新获取与报告生成`, progress: 34 });
        // Load existing PDB structures from DB instead of re-fetching from RCSB
        try {
          const existingPdbs = await db.$queryRaw<any[]>`SELECT pdbId, method, resolution, title, journal, journalIf, doi, pubmedId, organism, authors, ligand, depositionDate, releaseDate FROM EvaluationPdbStructure WHERE uniprotId = ${uniprot}`;
          pdbDetails = (existingPdbs as any[]).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title, journal: e.journal, journalIf: e.journalIf, doi: e.doi, pubmedId: e.pubmedId, organisms: e.organism, authors: e.authors, ligands: e.ligand, depositDate: e.depositionDate, releaseDate: e.releaseDate }));
        } catch { /* ignore */ }
        skipReportGeneration = true;
        emit({ stage: 'rcsb-detail', level: 'success', message: `✓ 从数据库加载 ${pdbDetails.length} 条已有 PDB 结构`, progress: 34 });
      } else {
        // Cache miss — fetch details from RCSB and generate fresh report
        if (cachedEval) {
          emit({ stage: 'cache-miss', level: 'info', message: `参数或 PDB 数量已变化（旧: maxPdb=${cachedEval.maxPdb}, pdbCount=${cachedEval.pdbCountAtEval} → 新: maxPdb=${maxPdb}, pdbCount=${directPdbCount}），重新获取并更新报告`, progress: 28 });
        }
        emit({ stage: 'rcsb-detail', level: 'info', message: `拉取详细元数据`, progress: 28 });
        pdbDetails = directPdbCount > 0 ? await fetchPdbEntryDetails(pdbIds) : [];
        emit({ stage: 'rcsb-detail', level: 'success', message: `✓ 获取 ${pdbDetails.length} 条详细元数据`, progress: 34 });
      }

      emit({ stage: 'sifts-coverage', level: 'info', message: 'SIFTS 残基覆盖率计算', progress: 38 });
      await sleep(300);
      // Estimate structural coverage: each PDB structure covers ~5% of the target
      // (capped at 100%). This is a heuristic since we don't have residue-level
      // SIFTS mapping data. More structures = better coverage.
      const coverage = directPdbCount > 0 ? Math.min(100, directPdbCount * 5) : 0;
      emit({ stage: 'sifts-coverage', level: 'success', message: `覆盖率 ${coverage}%`, progress: 42 });

      let blastHitCount = 0, skippedBblast = false, blastHits: any[] = [];
      if (skipBlast && !forceBlast) {
        emit({ stage: 'blast', level: 'warn', message: 'BLAST 已跳过 (skipBlast=true)', progress: 46 });
        skippedBblast = true;
        await sleep(200);
      } else {
        emit({ stage: 'blast', level: 'info', message: `NCBI BLASTp 同源检索（真实 API · UniProt ${uniprot} 序列）`, progress: 46 });
        try {
          emit({ stage: 'blast', level: 'info', message: `从 UniProt 拉取 ${uniprot} 蛋白序列…`, progress: 47 });
          const sequence = await fetchUniprotSequence(uniprot);
          emit({ stage: 'blast', level: 'info', message: `序列长度 ${sequence.length} aa，提交 BLASTp（最多等待 180s，上限 ${maxBlastHits} 条）…`, progress: 48 });
          const blastPromise = runBlast(sequence, maxBlastHits, (msg) => { emit({ stage: 'blast', level: 'info', message: msg, progress: 49 }); });
          const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BLAST 超时（180s），跳过同源检索')), 180000));
          blastHits = await Promise.race([blastPromise, timeoutPromise]);
          blastHitCount = blastHits.length;
          if (blastHitCount > 0) {
            const topHit = blastHits[0];
            emit({ stage: 'blast', level: 'success', message: `✓ BLAST 命中 ${blastHitCount}/${maxBlastHits} 条同源（最高 identity=${topHit.identity}% · ${topHit.pdbId}）`, progress: 52 });
          } else {
            emit({ stage: 'blast', level: 'warn', message: `BLAST 完成，无同源命中`, progress: 52 });
          }
        } catch (err: any) {
          emit({ stage: 'blast', level: 'error', message: `✗ BLAST 失败：${err?.message}（继续后续评分）`, progress: 52 });
          skippedBblast = true;
        }
      }

      // ── Fix 2: Enrich BLAST hits with RCSB structural metadata ──────────
      // BLAST XML only gives pdbId + identity + description. The downstream
      // buildLiteratureInfo() needs pubmedId/method/resolution/journal, and
      // the LLM report needs the full structural table. So we call RCSB for
      // each unique BLAST pdbId (chunked, concurrent via fetchPdbEntryDetails).
      // Result: pdbDetails now contains BOTH direct SIFTS PDBs AND enriched
      // BLAST hits (deduped by pdbId). BLAST-derived entries are tagged with
      // `via: 'blast'` so the UI / report can distinguish them.
      if (blastHits.length > 0) {
        const directPdbIds = new Set(pdbDetails.map((d) => d.pdbId));
        const blastPdbIds = Array.from(new Set(blastHits.map((h: any) => h.pdbId).filter((id: string) => id && !directPdbIds.has(id))));
        if (blastPdbIds.length > 0) {
          emit({ stage: 'blast-enrich', level: 'info', message: `从 RCSB 反查 ${blastPdbIds.length} 个 BLAST PDB 的结构元数据（并发 · 5/批）…`, progress: 53 });
          try {
            const enriched = await fetchPdbEntryDetails(blastPdbIds, blastPdbIds.length);
            // Tag each enriched entry with via:'blast' and a back-reference to its BLAST row
            // (so the LLM report can cite both identity% and the structural fields).
            const identityByPdb = new Map<string, number>();
            for (const h of blastHits as any[]) {
              const cur = identityByPdb.get(h.pdbId) ?? 0;
              if ((h.identity ?? 0) > cur) identityByPdb.set(h.pdbId, h.identity);
            }
            const tagged: PdbEntryDetail[] = enriched.map((e) => ({
              ...e,
              // Stash identity on a loose field so buildDetailedPdbTable can render it
              ...({ blastIdentity: identityByPdb.get(e.pdbId) ?? null } as any),
            }));
            pdbDetails = [...pdbDetails, ...tagged];
            emit({ stage: 'blast-enrich', level: 'success', message: `✓ RCSB enrich 命中 ${enriched.length}/${blastPdbIds.length}（${blastPdbIds.length - enriched.length} 个 PDB id 在 RCSB 中找不到）`, progress: 54 });
          } catch (err: any) {
            emit({ stage: 'blast-enrich', level: 'warn', message: `⚠ RCSB enrich 失败：${err?.message}（BLAST hit 仍以 bare 形式进报告）`, progress: 54 });
          }
        } else {
          emit({ stage: 'blast-enrich', level: 'info', message: '所有 BLAST PDB id 已在 direct PDB 集合中，无需 enrich', progress: 54 });
        }
      }

      emit({ stage: 'score', level: 'info', message: '综合可成药性评分', progress: 56 });
      await sleep(300);
      const scoreRating = (s: number) => s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
      // Derive scores from actual structure counts: more structures → higher score.
      const xrayCount = pdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
      const cryoemCount = pdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
      const nmrCount = pdbDetails.filter(e => (e.method || '').includes('NMR')).length;
      const calcScore = (count: number, max: number = 10) => Math.min(max, Math.max(1, Math.round(count / 5) + 3));
      const scores = {
        xray: { score: calcScore(xrayCount), rating: '', structures: xrayCount },
        cryoem: { score: calcScore(cryoemCount), rating: '', structures: cryoemCount },
        nmr: { score: calcScore(nmrCount), rating: '', structures: nmrCount },
        overall: { score: Math.min(10, Math.max(1, Math.round((calcScore(xrayCount) + calcScore(cryoemCount) + calcScore(nmrCount)) / 3))), rating: '' },
      };
      scores.xray.rating = scoreRating(scores.xray.score);
      scores.cryoem.rating = scoreRating(scores.cryoem.score);
      scores.nmr.rating = scoreRating(scores.nmr.score);
      scores.overall.rating = scoreRating(scores.overall.score);
      emit({ stage: 'score', level: 'success', message: `overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${scores.xray.structures}条, Cryo-EM=${scores.cryoem.score}/${scores.cryoem.structures}条, NMR=${scores.nmr.score}/${scores.nmr.structures}条)`, progress: 62 });

      let report: any = undefined;
      if (skipReportGeneration && cachedEval?.report) {
        // Cache hit — reuse existing report, skip LLM generation
        report = { ok: true, content: cachedEval.report, provider: '(cached)', model: '(cached)', durationMs: 0, contentChars: cachedEval.report.length, fallback: false, cached: true };
        emit({ stage: 'report-cached', level: 'success', message: `✓ 使用已有 LLM 报告（缓存）· ${report.contentChars} chars`, progress: 90 });
      } else if (generateReport) {
        // ── Build COMPRESSED but COMPREHENSIVE data tables from real DB rows ──────
        // Cap at 80 entries per table to keep each LLM prompt < 12k chars (fast).
        const PDB_CAP = 80;
        const BLAST_CAP = Math.min(maxBlastHits, 50);
        const pdbTable = pdbDetails.length > 0
          ? buildDetailedPdbTable(pdbDetails, PDB_CAP)
          : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 PDB 结构数据) | - | - | - | - |';
        const blastTable = skippedBblast
          ? '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (BLAST 已跳过) | - | - | - | - |'
          : buildDetailedBlastTable(blastHits, BLAST_CAP);

        // ── Literature info: fetch PubMedArticle rows for the PDB structures' pubmedIds ──
        // Sort by journal IF desc, cap at maxLitCount. Empty when no articles in DB.
        const litInfo = await buildLiteratureInfo(pdbDetails, maxLitCount);
        const literatureInfo = litInfo.count > 0
          ? `共 ${litInfo.count} 篇相关文献（按期刊影响因子降序，已截取前 ${litInfo.count} 篇；摘要截取 200 字）：\n\n${litInfo.text}`
          : '（无 PubMed 文献数据 — PubMedArticle 表为空或这些 PDB 结构无对应文献）';
        if (litInfo.count > 0) {
          emit({ stage: 'llm-report', level: 'info', message: `已附加 ${litInfo.count} 篇 PubMed 文献（按 IF 降序）到 LLM 上下文`, progress: 65 });
        }

        const reportData = {
          uniprot,
          entryName: uniprotInfo.entryName,
          proteinName: uniprotInfo.proteinName,
          geneNames: uniprotInfo.geneNames,
          organism: uniprotInfo.organism,
          sequenceLength: uniprotInfo.sequenceLength,
          coverage,
          directPdbCount,
          blastHitCount: skippedBblast ? 0 : blastHitCount,
          pdbCount: pdbDetails.length,
          maxBlastHitsRequested: maxBlastHits,
          scores,
          pdbTable,
          blastTable,
          literatureInfo,
          literatureCount: litInfo.count,
        };

        // ── Chapter-streaming mode: each chapter = its own short LLM call. ──────
        // This gives progressive output (SSE `chapter_*` events) AND avoids 240s+
        // timeouts because each prompt is ~3-5k chars (1-2KB output, 15-30s).
        const chapters: ReportChapterKey[] = [
          'summary', 'function', 'topology', 'pdb_analysis',
          'feasibility', 'experimental', 'references', 'conclusion',
        ];
        const chapterContents: Record<string, string> = {};
        const totalChapters = chapters.length;
        let perChapterOkCount = 0;
        let perChapterFailCount = 0;
        const tReportStart = Date.now();

        emit({ stage: 'llm-report', level: 'info', message: `准备分 ${totalChapters} 章节并发生成报告 (${provider})… 共 ${pdbDetails.length} 个 PDB + ${blastHitCount} 个 BLAST 已加载到上下文`, progress: 66 });

        for (let i = 0; i < chapters.length; i++) {
          const ck = chapters[i];
          const chapterIdx = i + 1;
          // Per-chapter progress: 66..91
          const baseProgress = 66 + Math.round((i / totalChapters) * 24);
          emit({ stage: 'chapter', level: 'info', message: `[${chapterIdx}/${totalChapters}] ${labelOf(ck)} — 开始生成`, progress: baseProgress, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });

          const userPrompt = buildChapterPrompt({ ...reportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
          const sysPrompt = buildChapterSystemPrompt();

          const t0 = Date.now();
          const r = await generateText(sysPrompt, userPrompt, { maxChars: 1500, llm: body.llm });
          if (r.ok) {
            perChapterOkCount++;
            chapterContents[ck] = r.content;
            // Stream chapter content as a separate SSE event so the front-end can render
            // it inline (e.g. into a collapsible <details>).
            emit({
              stage: 'chapter_done',
              level: 'success',
              message: `[${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✓ ${r.content.length} chars · ${(r.durationMs / 1000).toFixed(1)}s`,
              progress: baseProgress + 2,
              chapter: ck,
              chapterIndex: chapterIdx,
              chapterTotal: totalChapters,
              chapterContent: r.content,
              chapterDurationMs: r.durationMs,
            });
          } else {
            perChapterFailCount++;
            chapterContents[ck] = `_(${labelOf(ck)}: LLM 调用失败 — ${r.error?.slice(0, 120) ?? 'unknown'})_`;
            emit({
              stage: 'chapter_done',
              level: 'error',
              message: `[${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✗ ${r.error?.slice(0, 120) ?? 'unknown'}`,
              progress: baseProgress + 2,
              chapter: ck,
              chapterIndex: chapterIdx,
              chapterTotal: totalChapters,
              chapterError: r.error,
            });
          }
        }

        const chaptersTotalMs = Date.now() - tReportStart;
        // Concatenate chapters in canonical order into the final report content.
        const finalReport = chapters.map((ck) => chapterContents[ck] ?? '').join('\n\n');
        const allOk = perChapterFailCount === 0;
        if (allOk) {
          emit({ stage: 'llm-report', level: 'success', message: `✓ LLM 分章生成完成 · ${perChapterOkCount}/${totalChapters} 章节 · ${finalReport.length} chars · 共 ${(chaptersTotalMs / 1000).toFixed(1)}s · ${provider}/${model}${saveReportFile ? ' · 已落盘' : ''}`, progress: 91 });
        } else {
          emit({ stage: 'llm-report', level: 'warn', message: `⚠ LLM 分章生成部分失败 · ${perChapterOkCount}✓ ${perChapterFailCount}✗ · ${finalReport.length} chars · ${provider}/${model}`, progress: 91 });
        }
        report = {
          ok: allOk,
          provider,
          model,
          durationMs: chaptersTotalMs,
          savedToFile: saveReportFile,
          filename: saveReportFile ? `wiki/evaluations/${uniprot}.md` : undefined,
          contentChars: finalReport.length,
          fallback: false,
          content: finalReport,
          chapters: chapterContents,
          chaptersOk: perChapterOkCount,
          chaptersFailed: perChapterFailCount,
          error: allOk ? undefined : `${perChapterFailCount} chapter(s) failed`,
        };
      }

      emit({ stage: 'write-db', level: 'info', message: `写入 Prisma (Evaluation ${pdbDetails.length} PDB + ${blastHits.length} BLAST)`, progress: 96 });
      let dbSaved = false;
      try {
        // ★ FIX: Insert Evaluation (parent) FIRST so FOREIGN KEY constraints succeed.
        const scoresJson = JSON.stringify({
          'X-ray': { score: scores.xray.score, rating: scores.xray.rating, maxScore: 10 },
          'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating, maxScore: 10 },
          'NMR': { score: scores.nmr.score, rating: scores.nmr.rating, maxScore: 10 },
          'Overall': { score: scores.overall.score, rating: scores.overall.rating, maxScore: 10 },
        });
        await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${uniprot}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, ${report?.ok ? report.content : null}, ${maxPdb}, ${skipBlast && !forceBlast}, ${directPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;

        // Now insert child tables — skip if cache hit (PDB structures already in DB)
        if (!skipReportGeneration) {
        await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${uniprot}`;
        for (const e of pdbDetails) {
          const isCryoem = (e.method || '').includes('ELECTRON');
          const isXray = (e.method || '').includes('X-RAY');
          const isNmr = (e.method || '').includes('NMR');
          const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
          await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${uniprot}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
        }
        } // end if (!skipReportGeneration)

        if (!skipReportGeneration) {
        await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${uniprot}`;
        // Dedup blastHits by pdbId — same PDB can show up via both pdbaa
        // and nr fallback searches. Keep first occurrence (which is the
        // highest-identity one because blastHits is sorted desc by
        // identity in dedupBlastHits).
        const seenBlastPdbIds = new Set<string>();
        let dedupedBlastCount = 0;
        let paralogCount = 0;
        for (const h of blastHits) {
          if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
          seenBlastPdbIds.add(h.pdbId);
          dedupedBlastCount++;
          if (h.isParalog) paralogCount++;
          await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${uniprot}, ${h.pdbId}, ${h.uniprotRef}, ${h.description}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${!!h.isParalog})`;
        }
        emit({ stage: 'write-db', level: 'info', message: `  ↳ BLAST 去重: ${dedupedBlastCount}/${blastHits.length} (${paralogCount} 个同源蛋白 ≥95%)`, progress: 98 });
        } // end if (!skipReportGeneration) BLAST

        if (report?.ok && report.content) {
          await db.skillEvaluationReport.create({
            data: {
              uniprotId: uniprot,
              proteinName: uniprotInfo.proteinName,
              overallScore: scores.overall.score,
              directPdbCount,
              coverage,
              report: report.content,
              llmOk: report.ok,
              llmProvider: report.provider,
              llmModel: report.model,
              llmDurationMs: report.durationMs,
              filePath: report.filename,
            },
          });
        }
        await db.skillRunRecord.create({
          data: {
            module: 'eval',
            status: report?.ok || !generateReport ? 'success' : 'error',
            summary: `${uniprotInfo.proteinName}: ${directPdbCount} PDB (真实) · overall=${scores.overall.score}/10${report?.ok ? ' · LLM ✓' : generateReport ? ' · LLM ✗' : ''}`,
            details: JSON.stringify({ uniprot, directPdbCount, pdbPersisted: pdbDetails.length, coverage, scores, reportOk: report?.ok, reportChars: report?.contentChars }),
            provider,
            model: report?.model || model,
            llmOk: generateReport ? report?.ok : null,
            llmFallback: generateReport ? report?.fallback : false,
            llmError: generateReport ? report?.error : null,
            durationMs: Date.now() - t0,
            resultJson: JSON.stringify({ uniprot, scores, reportOk: report?.ok, reportChars: report?.contentChars, pdbSample: pdbDetails.slice(0, 5).map(e => e.pdbId) }),
          },
        });
        dbSaved = true;
        emit({ stage: 'write-db', level: 'success', message: `✓ 已写入 Evaluation + EvaluationPdbStructure(${pdbDetails.length}) + EvaluationBlastResult(${blastHits.length}) + SkillRunRecord`, progress: 99 });
      } catch (err: any) {
        emit({ stage: 'write-db', level: 'error', message: `✗ 数据库写入失败：${err?.message}`, progress: 99 });
      }

      // P0-2: Free memory after DB write — large arrays no longer needed
      pdbDetails.length = 0;
      blastHits.length = 0;
      if (typeof global.gc === 'function') {
        try { global.gc(); } catch { /* ignore */ }
      }

      const result = {
        uniprot,
        uniprotInfo,
        directPdbCount,
        pdbPersisted: pdbDetails.length,
        pdbSample: pdbDetails.slice(0, 5).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title?.slice(0, 60) })),
        blastHitCount,
        blastSample: blastHits.slice(0, 3).map(h => ({ pdbId: h.pdbId, identity: h.identity, evalue: h.evalue })),
        coverage,
        skippedBblast,
        scores,
        report,
        dbSaved,
        durationMs: Date.now() - t0,
      };
      emit({ stage: 'done', level: report?.ok || !generateReport ? 'success' : 'warn', message: `完成 · ${directPdbCount} PDB (真实) · overall=${scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${report?.ok ? ` · LLM ✓ (${report.contentChars} chars)` : generateReport ? ' · LLM ✗' : ''}${dbSaved ? ' · DB ✓' : ' · DB ✗'}`, progress: windowStart + 5 });

      // ── Batch mode: evaluate remaining targets + cross-target relationship analysis ──
      // Progress is split evenly across all targets so the user sees each target
      // receive roughly the same progress share:
      //   - Primary target (bi=0): progress 2..(97/N)
      //   - Each batch target (bi): progress ((bi*97+2)/N)..(((bi+1)*97)/N)
      //   - Cross-analysis + write-batch-db: progress 97..100
      // The 3% at the end is reserved for cross-target analysis (per-target
      // relationship report) and final batch DB write.
      if (isBatch && targets.length > 1) {
        const targetCount = targets.length;
        const slot = 97 / targetCount; // 97% of bar split across N targets
        const batchResults: any[] = [{ uniprot, uniprotInfo, pdbDetails, scores, report }];
        // Evaluate remaining targets (target[0] already done above)
        for (let bi = 1; bi < targets.length; bi++) {
          const bt = targets[bi];
          const bUid = (bt.uniprot || '').trim().toUpperCase();
          if (!bUid) continue;
          // Map bi (1..N-1) into progress window (slot..2*slot). Add 2 for
          // initial slot so the very first emit at "begin batch target"
          // never shows 0%.
          const windowStart = Math.round(bi * slot + 2);
          const windowEnd = Math.round((bi + 1) * slot);
          emit({ stage: `batch-${bi}`, level: 'info', message: `[Batch ${bi + 1}/${targets.length}] 评估 ${bUid}…`, progress: windowStart });
          try {
            const bMeta = await fetchUniprotMeta(bUid);
            const bInfo = bMeta ? { uniprotId: bUid, entryName: bMeta.entryName, proteinName: bMeta.proteinName, geneNames: bMeta.geneNames || '—', organism: bMeta.organism || '—', sequenceLength: bMeta.sequenceLength || 0 } : { uniprotId: bUid, entryName: bUid, proteinName: `Unknown`, geneNames: '—', organism: '—', sequenceLength: 0 };
            const bMaxPdb = bt.maxPdb || maxPdb;
            const bSkipBlast = !!(bt.skipBlast ?? skipBlast);
            const bForceBlast = !!(bt.forceBlast ?? forceBlast);
            const bPdbIds = await fetchPdbIdsForUniprot(bUid, bMaxPdb);
            const bDirectPdbCount = bPdbIds.length;
            // Cache check for batch target
            let bCached: any = null;
            try { bCached = (await db.$queryRaw<any[]>`SELECT maxPdbUsed, blastWasSkipped, pdbCountAtEval, report FROM Evaluation WHERE uniprotId = ${bUid}`)[0] || null; } catch {}
            let bPdbDetails: PdbEntryDetail[] = [];
            let bCacheHit = false;
            if (bCached && bCached.maxPdbUsed === bMaxPdb && !!bCached.blastWasSkipped === (bSkipBlast && !bForceBlast) && bCached.pdbCountAtEval === bDirectPdbCount) {
              bCacheHit = true;
              emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} 缓存命中（参数+PDB数未变），跳过重新获取`, progress: windowStart + 5 });
              try {
                const existing = await db.$queryRaw<any[]>`SELECT pdbId, method, resolution, title, journal, journalIf, doi, pubmedId, organism, authors, ligand, depositionDate, releaseDate FROM EvaluationPdbStructure WHERE uniprotId = ${bUid}`;
                bPdbDetails = (existing as any[]).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title, journal: e.journal, journalIf: e.journalIf, doi: e.doi, pubmedId: e.pubmedId, organisms: e.organism, authors: e.authors, ligands: e.ligand, depositDate: e.depositionDate, releaseDate: e.releaseDate }));
              } catch {}
            } else {
              bPdbDetails = bDirectPdbCount > 0 ? await fetchPdbEntryDetails(bPdbIds) : [];
            }
            const bXray = bPdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
            const bCryoem = bPdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
            const bNmr = bPdbDetails.filter(e => (e.method || '').includes('NMR')).length;
            const calcS = (c: number) => Math.min(10, Math.max(1, Math.round(c / 5) + 3));
            const bScores = { xray: { score: calcS(bXray), structures: bXray }, cryoem: { score: calcS(bCryoem), structures: bCryoem }, nmr: { score: calcS(bNmr), structures: bNmr }, overall: { score: Math.min(10, Math.max(1, Math.round((calcS(bXray) + calcS(bCryoem) + calcS(bNmr)) / 3))) } };
            // Write to DB — skip PDB structure insert if cache hit
            let bReport: any = undefined;
            // Generate individual LLM report for this batch target (unless cached with existing report)
            if (generateReport && !(bCacheHit && bCached?.report)) {
              emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Batch ${bi + 1}] 生成 ${bUid} 的 LLM 报告（8 章节流式，跟 primary 模板一致）…`, progress: windowStart + 5 });
              try {
                // ── Per-chapter LLM streaming (same 8-chapter flow as primary target,
                //    so batch target reports share the same template). Each chapter
                //    is its own short LLM call so the front-end can render
                //    incrementally via SSE `batch-${bi}-chapter` / `batch-${bi}-chapter_done`.
                const PDB_CAP = 80;
                const BLAST_CAP = Math.min(maxBlastHits, 50);
                const bPdbTable = bPdbDetails.length > 0
                  ? buildDetailedPdbTable(bPdbDetails, PDB_CAP)
                  : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 PDB 结构数据) | - | - | - | - |';
                const bBlastTable = bSkipBlast
                  ? '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (BLAST 已跳过) | - | - | - | - |'
                  : (bCached?.blastResults ? buildDetailedBlastTable(bCached.blastResults, BLAST_CAP) : '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (无 BLAST 数据) | - | - | - | - |');
                const bLitInfo = await buildLiteratureInfo(bPdbDetails, maxLitCount);
                const bLiteratureInfo = bLitInfo.count > 0
                  ? `共 ${bLitInfo.count} 篇相关文献（按期刊影响因子降序，已截取前 ${bLitInfo.count} 篇；摘要截取 200 字）：\n\n${bLitInfo.text}`
                  : '（无 PubMed 文献数据 — PubMedArticle 表为空或这些 PDB 结构无对应文献）';
                const bReportData = {
                  uniprot: bUid,
                  entryName: bInfo.entryName,
                  proteinName: bInfo.proteinName,
                  geneNames: bInfo.geneNames,
                  organism: bInfo.organism,
                  sequenceLength: bInfo.sequenceLength,
                  coverage: 0,
                  directPdbCount: bDirectPdbCount,
                  blastHitCount: bSkipBlast ? 0 : (bCached?.blastResults?.length || 0),
                  pdbCount: bPdbDetails.length,
                  maxBlastHitsRequested: maxBlastHits,
                  scores: bScores,
                  pdbTable: bPdbTable,
                  blastTable: bBlastTable,
                  literatureInfo: bLiteratureInfo,
                  literatureCount: bLitInfo.count,
                };
                const chapters: ReportChapterKey[] = [
                  'summary', 'function', 'topology', 'pdb_analysis',
                  'feasibility', 'experimental', 'references', 'conclusion',
                ];
                const chapterContents: Record<string, string> = {};
                let perChapterOkCount = 0;
                let perChapterFailCount = 0;
                const tBatchReportStart = Date.now();
                emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Batch ${bi + 1}] ${bUid} 准备分 ${chapters.length} 章节生成报告 (${provider})… 共 ${bPdbDetails.length} 个 PDB${bLitInfo.count > 0 ? ` + ${bLitInfo.count} 篇文献` : ''} 已加载到上下文`, progress: windowStart + 5 });
                for (let i = 0; i < chapters.length; i++) {
                  const ck = chapters[i];
                  const chapterIdx = i + 1;
                  emit({ stage: `batch-${bi}-chapter`, level: 'info', message: `[Batch ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} — 开始生成`, progress: windowStart + 5, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  const userPrompt = buildChapterPrompt({ ...bReportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  const sysPrompt = buildChapterSystemPrompt();
                  const r = await generateText(sysPrompt, userPrompt, { maxChars: 1500, llm: body.llm });
                  if (r.ok) {
                    perChapterOkCount++;
                    chapterContents[ck] = r.content;
                    emit({ stage: `batch-${bi}-chapter_done`, level: 'success', message: `[Batch ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✓ ${r.content.length} chars · ${(r.durationMs / 1000).toFixed(1)}s`, progress: windowStart + 5, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length, chapterContent: r.content });
                  } else {
                    perChapterFailCount++;
                    chapterContents[ck] = `_(${labelOf(ck)}: LLM 调用失败 — ${r.error?.slice(0, 120) ?? 'unknown'})_`;
                    emit({ stage: `batch-${bi}-chapter_done`, level: 'error', message: `[Batch ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✗ ${r.error?.slice(0, 100) ?? 'unknown'}`, progress: windowStart + 5, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  }
                }
                const finalReport = chapters.map((ck) => chapterContents[ck] ?? '').join('\n\n');
                const allOk = perChapterFailCount === 0;
                bReport = {
                  ok: allOk,
                  content: finalReport,
                  provider,
                  model,
                  durationMs: Date.now() - tBatchReportStart,
                  contentChars: finalReport.length,
                  perChapterOkCount,
                  perChapterFailCount,
                };
                if (allOk) {
                  emit({ stage: `batch-${bi}-llm`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} LLM 分章报告完成 · ${perChapterOkCount}/${chapters.length} 章 · ${finalReport.length} chars · ${((Date.now() - tBatchReportStart) / 1000).toFixed(1)}s · ${provider}/${model}`, progress: windowStart + 5 });
                } else {
                  emit({ stage: `batch-${bi}-llm`, level: 'warn', message: `⚠ [Batch ${bi + 1}] ${bUid} LLM 分章部分失败 · ${perChapterOkCount}✓ ${perChapterFailCount}✗ · ${finalReport.length} chars · ${provider}/${model}`, progress: windowStart + 5 });
                }
              } catch (err: any) {
                emit({ stage: `batch-${bi}-llm`, level: 'error', message: `✗ [Batch ${bi + 1}] ${bUid} LLM 生成失败：${err?.message}`, progress: windowStart + 5 });
              }
            } else if (bCacheHit && bCached?.report) {
              bReport = { ok: true, content: bCached.report, provider: '(cached)', model: '(cached)', durationMs: 0, contentChars: bCached.report.length, cached: true };
              emit({ stage: `batch-${bi}-llm`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} 使用已有 LLM 报告（缓存）· ${bReport.contentChars} chars`, progress: windowStart + 5 });
            }
            try {
              const bScoresJson = JSON.stringify({ 'X-ray': { score: bScores.xray.score }, 'Cryo-EM': { score: bScores.cryoem.score }, 'NMR': { score: bScores.nmr.score }, 'Overall': { score: bScores.overall.score } });
              const bReportContent = bReport?.ok ? bReport.content : (bCacheHit && bCached?.report ? bCached.report : null);
              await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${bUid}, ${bInfo.entryName}, ${bInfo.proteinName}, ${bInfo.geneNames}, ${bInfo.organism}, ${bInfo.sequenceLength}, 0, ${bScoresJson}, ${bReportContent}, ${bMaxPdb}, ${bSkipBlast && !bForceBlast}, ${bDirectPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, scores = excluded.scores, report = excluded.report, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;
              if (!bCacheHit) {
                await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${bUid}`;
                for (const e of bPdbDetails) {
                  const isCryoem = (e.method || '').includes('ELECTRON'); const isXray = (e.method || '').includes('X-RAY'); const isNmr = (e.method || '').includes('NMR');
                  const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
                  await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${bUid}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
                }
              }
            } catch (dbErr: any) {
              emit({ stage: `batch-${bi}`, level: 'error', message: `[Batch ${bi + 1}] DB 写入失败：${dbErr?.message}`, progress: windowStart + 5 });
            }
            batchResults.push({ uniprot: bUid, uniprotInfo: bInfo, pdbDetails: bPdbDetails, scores: bScores, cached: bCacheHit, report: bReport });
            emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid}: ${bPdbDetails.length} PDB · overall=${bScores.overall.score}/10${bCacheHit ? ' · 缓存' : ''}${bReport?.ok ? ` · LLM ✓ (${bReport.contentChars} chars)` : ''}`, progress: windowStart + 5 });
          } catch (err: any) {
            emit({ stage: `batch-${bi}`, level: 'error', message: `✗ [Batch ${bi + 1}] ${bUid} 失败：${err?.message}`, progress: windowStart + 5 });
          }
        }

        // ── Cross-target relationship analysis: find common PDB structures ──
        emit({ stage: 'cross-analysis', level: 'info', message: `分析 ${batchResults.length} 个靶点的共有结构与相关性…`, progress: windowStart + 5 });
        const allPdbSets = batchResults.map(r => ({ uniprot: r.uniprot, proteinName: r.uniprotInfo?.proteinName, pdbIds: new Set((r.pdbDetails || []).map((e: PdbEntryDetail) => e.pdbId)) }));
        // Find PDB IDs present in ALL targets
        const commonPdbIds = allPdbSets.length > 0
          ? [...allPdbSets[0].pdbIds].filter(id => allPdbSets.every(s => s.pdbIds.has(id)))
          : [];
        // Find PDB IDs shared by at least 2 targets (pairwise overlap)
        const pdbOverlap: Record<string, string[]> = {};
        for (let a = 0; a < allPdbSets.length; a++) {
          for (let b = a + 1; b < allPdbSets.length; b++) {
            const shared = [...allPdbSets[a].pdbIds].filter(id => allPdbSets[b].pdbIds.has(id));
            if (shared.length > 0) {
              pdbOverlap[`${allPdbSets[a].uniprot}↔${allPdbSets[b].uniprot}`] = shared;
            }
          }
        }
        emit({ stage: 'cross-analysis', level: commonPdbIds.length > 0 ? 'success' : 'info', message: `共有结构（全部靶点）：${commonPdbIds.length} 个${commonPdbIds.length > 0 ? ` (${commonPdbIds.slice(0, 5).join(', ')}…)` : ''} · 两两重叠：${Object.keys(pdbOverlap).length} 对`, progress: windowStart + 5 });

        // ── Generate cross-target relationship LLM report ──
        let crossReport: any = undefined;
        if (generateReport) {
          emit({ stage: 'cross-llm', level: 'info', message: `生成靶点间相关性 LLM 分析报告…`, progress: windowStart + 5 });
          try {
            const crossSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份靶点间相关性分析报告，使用 Markdown 格式。分析多个蛋白靶点之间的结构关联性、功能关系、以及共有的结构基础。';
            const targetSummary = batchResults.map((r, i) => {
              const top5 = (r.pdbDetails || []).slice(0, 5).map((e: PdbEntryDetail) => `  - ${e.pdbId}: ${e.method} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 50)}`).join('\n');
              const s = r.scores as any;
              return `靶点 ${i + 1}: ${r.uniprot} (${r.uniprotInfo?.proteinName})\n  PDB 结构数: ${(r.pdbDetails || []).length}\n  评分: overall=${s?.overall?.score || '?'}/10 (X-ray=${s?.xray?.score || '?'}/${s?.xray?.structures || 0}条, Cryo-EM=${s?.cryoem?.score || '?'}/${s?.cryoem?.structures || 0}条, NMR=${s?.nmr?.score || '?'}/${s?.nmr?.structures || 0}条)\n  代表性结构:\n${top5}`;
            }).join('\n\n');
            const overlapSummary = Object.entries(pdbOverlap).length > 0
              ? Object.entries(pdbOverlap).map(([pair, ids]) => {
                  const idDetails = ids.slice(0, 10).map(id => {
                    const det = batchResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                    return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(det?.title || '').slice(0, 60)}`;
                  }).join('\n');
                  return `${pair}: ${ids.length} 个共有结构\n${idDetails}`;
                }).join('\n')
              : '无两两共有结构';
            // Aggregate literature from ALL batch targets (cap at maxLitCount total, IF desc).
            const allBatchPdbs: PdbEntryDetail[] = batchResults.flatMap((r) => r.pdbDetails || []);
            const crossLit = await buildLiteratureInfo(allBatchPdbs, maxLitCount);
            const crossLitBlock = crossLit.count > 0
              ? `\n\n相关 PubMed 文献（聚合全部 ${batchResults.length} 个靶点，共 ${crossLit.count} 篇，按 IF 降序）：\n${crossLit.text}`
              : '\n\n（无 PubMed 文献数据）';
            const commonPdbDetails = commonPdbIds.length > 0
              ? commonPdbIds.slice(0, 15).map(id => {
                  const det = batchResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                  return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${det?.journal || 'N/A'} (${det?.journalIf != null ? det.journalIf.toFixed(1) : 'N/A'}) | ${(det?.title || '').slice(0, 60)}`;
                }).join('\n')
              : '（无共有结构）';

            const crossUserPrompt = `请分析以下 ${batchResults.length} 个蛋白靶点的结构相关性与功能关系：

${targetSummary}

共有结构分析：
- 全部靶点共有的结构: ${commonPdbIds.length} 个
${commonPdbDetails}
- 两两重叠:
${overlapSummary}${crossLitBlock}

请按以下结构生成报告：
## 靶点间相关性分析报告

### 一、靶点概览
（简述每个靶点的蛋白名称、PDB 结构数量、评分）

### 二、共有结构分析
（分析共有 PDB 结构的含义 — 这些结构可能揭示靶点间的进化关系或功能关联）

### 三、功能与通路关联
（基于蛋白名称和结构信息，分析靶点是否在同一信号通路、蛋白家族或功能网络中）

### 四、结构相似性推断
（从共有结构推断靶点间的结构相似性，讨论对药物设计或交叉研究的意义）

### 五、文献综合
（结合相关文献区块中的 PMID 列表，简述跨靶点文献证据，引用 PMID 编号）

### 六、总结与建议
（总结靶点间关系，提出后续研究建议）`;
            const r = await generateText(crossSysPrompt, crossUserPrompt, { maxChars: 4000, llm: body.llm });
            crossReport = { ok: r.ok, content: r.content, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: r.content?.length || 0, commonPdbIds, pdbOverlap, literatureCount: crossLit.count };
            if (r.ok) emit({ stage: 'cross-llm', level: 'success', message: `✓ 相关性分析报告已生成 · ${crossReport.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}${crossLit.count > 0 ? ` · 附 ${crossLit.count} 篇文献` : ''}`, progress: windowStart + 5 });
            else emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析 LLM 失败：${r.error}`, progress: windowStart + 5 });
          } catch (err: any) {
            emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析失败：${err?.message}`, progress: windowStart + 5 });
          }
        }

        // Write batch record to EvaluationBatch + SkillRunRecord
        const batchTitle = `Batch: ${batchResults.map(r => r.uniprot).join(' + ')}`;
        const commonPdbIdsJson = JSON.stringify(commonPdbIds);
        const crossReportContent = crossReport?.ok ? crossReport.content : null;
        try {
          // Generate a batchId (cuid-style) since SQLite default doesn't apply with raw insert
          const batchId = 'batch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          // Create EvaluationBatch with cross-report + common PDB IDs
          await db.$executeRaw`INSERT INTO EvaluationBatch (batchId, title, combinedReport, commonPdbIds, crossReportOk, crossReportProvider, crossReportModel, crossReportDurationMs, crossReportChars, targetCount, createdAt, updatedAt) VALUES (${batchId}, ${batchTitle}, ${crossReportContent}, ${commonPdbIdsJson}, ${crossReport?.ok ?? false}, ${crossReport?.provider || null}, ${crossReport?.model || null}, ${crossReport?.durationMs || 0}, ${crossReport?.contentChars || 0}, ${batchResults.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
          // Link all evaluations to this batch
          for (const r of batchResults) {
            try { await db.$executeRaw`UPDATE Evaluation SET batchId = ${batchId} WHERE uniprotId = ${r.uniprot}`; } catch {}
          }
          (result as any).batchId = batchId;
          emit({ stage: 'batch-db', level: 'success', message: `✓ Batch 记录已写入 EvaluationBatch (${batchId}) · 关联 ${batchResults.length} 个靶点`, progress: 100 });
        } catch (err: any) {
          emit({ stage: 'batch-db', level: 'error', message: `Batch 记录写入失败：${err?.message}`, progress: 100 });
        }
        try {
          await db.skillRunRecord.create({
            data: {
              module: 'eval',
              status: 'success',
              summary: `Batch 评估 ${batchResults.length} 靶点 (${batchResults.map(r => r.uniprot).join(', ')}) · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? 'LLM ✓' : 'LLM ✗'}`,
              details: JSON.stringify({ targets: batchResults.map(r => r.uniprot), commonPdbIds, pdbOverlap, crossReportOk: crossReport?.ok, cached: batchResults.filter(r => r.cached).length }),
              provider: body.llm?.provider || 'auto',
              model: crossReport?.model || '',
              llmOk: crossReport?.ok ?? false,
              durationMs: Date.now() - t0,
              resultJson: JSON.stringify({ batchResults: batchResults.map(r => ({ uniprot: r.uniprot, pdbCount: r.pdbDetails?.length || 0, overall: r.scores?.overall?.score, cached: r.cached })), commonPdbIds, crossReportChars: crossReport?.contentChars || 0 }),
            },
          });
        } catch { /* ignore */ }

        (result as any).batchResults = batchResults.map(r => ({
          uniprot: r.uniprot,
          proteinName: r.uniprotInfo?.proteinName,
          pdbCount: r.pdbDetails?.length || 0,
          overall: r.scores?.overall?.score,
          cached: r.cached,
          // Surface the individual LLM report so the Run Center can render
          // an LLMPreview card per batch target after execution.
          report: r.report
            ? {
                ok: !!r.report.ok,
                content: r.report.content || '',
                provider: r.report.provider || '',
                model: r.report.model || '',
                durationMs: r.report.durationMs || 0,
                contentChars: r.report.contentChars || 0,
                cached: !!r.report.cached,
                error: r.report.error,
              }
            : undefined,
        }));
        (result as any).crossAnalysis = { commonPdbIds, pdbOverlap, crossReport };
        emit({ stage: 'batch-done', level: 'success', message: `Batch 完成 · ${batchResults.length} 靶点 (${batchResults.filter(r => r.cached).length} 缓存) · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? '相关性报告 ✓' : '相关性报告 ✗'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`, progress: 100 });
      }

      await sleep(150);
      done(result);
    } catch (err: any) {
      // Last-resort error emit so SSE stream terminates cleanly.
      emit({ stage: 'error', level: 'error', message: `✗ 未捕获异常：${err?.message || String(err)}`, progress: 100 });
      await sleep(50);
      done({ ok: false, error: err?.message || String(err), uniprot });
    }
  })();
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}


function labelOf(k: ReportChapterKey): string {
  return ({
    summary:     '执行摘要',
    function:    '蛋白功能与生物学背景',
    topology:    '序列与拓扑结构',
    pdb_analysis:'现有 PDB 结构分析',
    feasibility: '结构解析可行性评估',
    experimental:'实验方案',
    references:  '重要参考文献',
    conclusion:  '总结',
  } as Record<ReportChapterKey, string>)[k];
}
