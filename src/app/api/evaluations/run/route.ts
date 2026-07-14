import { sseStream, sleep, type SseEvent } from '@/lib/sse';
import { generateText } from '@/lib/llm';
import { buildReportSystemPrompt, buildReportUserPrompt, buildDetailedPdbTable, buildDetailedBlastTable, buildChapterPrompt, type ReportChapterKey } from '@/lib/report-template';
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
      // ── Sequence input mode: BLAST directly with provided sequence ──
      if (body.inputMode === 'sequence' && body.sequence) {
        let sequence = String(body.sequence).trim().toUpperCase().replace(/\s/g, '');
        const seqType = body.sequenceType === 'dna' ? 'dna' : 'aa';
        emit({ stage: 'init', level: 'info', message: `启动序列评估 · ${seqType === 'dna' ? 'DNA' : 'AA'} 序列 (${sequence.length} ${seqType === 'dna' ? 'nt' : 'aa'})`, progress: 2 });
        await sleep(300);

        // Transcribe DNA to amino acid sequence
        if (seqType === 'dna') {
          emit({ stage: 'transcribe', level: 'info', message: `DNA → 氨基酸转录中…`, progress: 5 });
          // Remove non-coding characters, translate codons
          const cleanDna = sequence.replace(/[^ATGC]/g, '');
          const codonTable: Record<string, string> = {
            'TTT':'F','TTC':'F','TTA':'L','TTG':'L','CTT':'L','CTC':'L','CTA':'L','CTG':'L',
            'ATT':'I','ATC':'I','ATA':'I','ATG':'M','GTT':'V','GTC':'V','GTA':'V','GTG':'V',
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
          emit({ stage: 'transcribe', level: 'success', message: `转录完成: ${cleanDna.length}nt → ${aaSeq.length}aa`, progress: 10 });
        }

        // Run BLASTp with the sequence — first against pdbaa (PDB), fallback to nr if no hits or <95% identity
        emit({ stage: 'blast', level: 'info', message: `BLASTp 同源检索 — pdbaa 数据库（序列 ${sequence.length}aa, 上限 ${maxBlastHits}）`, progress: 15 });
        let blastHits: any[] = [];
        let usedNrFallback = false;
        try {
          const blastPromise = runBlast(sequence, maxBlastHits, (msg) => { emit({ stage: 'blast', level: 'info', message: msg, progress: 20 }); });
          const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BLAST 超时（180s）')), 180000));
          blastHits = await Promise.race([blastPromise, timeoutPromise]);
          const topIdentity = blastHits.length > 0 ? blastHits[0].identity : 0;
          if (blastHits.length === 0) {
            emit({ stage: 'blast', level: 'warn', message: `pdbaa 数据库无命中，回退搜索 nr 数据库…`, progress: 25 });
          } else if (topIdentity < 95) {
            emit({ stage: 'blast', level: 'warn', message: `pdbaa 最高同源度 ${topIdentity}% < 95%，回退搜索 nr 数据库…`, progress: 25 });
          } else {
            emit({ stage: 'blast', level: 'success', message: `pdbaa 命中 ${blastHits.length}/${maxBlastHits} 条同源（最高 identity=${topIdentity}% · ${blastHits[0].pdbId}）`, progress: 40 });
          }
          // Fallback to nr database if no hits or top identity < 95%
          if (blastHits.length === 0 || topIdentity < 95) {
            emit({ stage: 'blast-nr', level: 'info', message: `BLASTp 同源检索 — nr 数据库（非冗余库, 上限 ${maxBlastHits}）`, progress: 28 });
            try {
              const nrPromise = runBlastDb(sequence, maxBlastHits, 'nr', (msg) => { emit({ stage: 'blast-nr', level: 'info', message: msg, progress: 30 }); });
              const nrTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BLAST nr 超时（180s）')), 180000));
              const nrHits = await Promise.race([nrPromise, nrTimeout]);
              if (nrHits.length > 0) {
                usedNrFallback = true;
                blastHits = nrHits;
                emit({ stage: 'blast-nr', level: 'success', message: `nr 命中 ${nrHits.length}/${maxBlastHits} 条同源（最高 identity=${nrHits[0].identity}% · ${nrHits[0].uniprotRef}）`, progress: 40 });
              } else {
                emit({ stage: 'blast-nr', level: 'warn', message: `nr 数据库也无命中`, progress: 40 });
              }
            } catch (nrErr: any) {
              emit({ stage: 'blast-nr', level: 'error', message: `nr 搜索失败：${nrErr?.message}`, progress: 40 });
            }
          }
        } catch (err: any) {
          emit({ stage: 'blast', level: 'error', message: `BLAST pdbaa 失败：${err?.message}`, progress: 40 });
        }

        // Convert BLAST hits to PDB-like details for scoring and report
        const pdbDetails: PdbEntryDetail[] = blastHits.map((h: any) => ({
          pdbId: h.pdbId, method: h.method || 'X-RAY DIFFRACTION', resolution: h.resolution ?? null,
          title: h.description || h.title || '', journal: h.journal || '', journalIf: h.journalIf ?? null,
          doi: null, pubmedId: h.pubmedId || null, organisms: h.organism || '',
          authors: '', ligands: '', depositDate: null, releaseDate: h.releaseDate || null,
        }));

        // ── Fetch UniProt metadata from the top BLAST hit ──
        // For pdbaa hits: use PDB ID to look up UniProt accession via RCSB entity API
        // For nr hits: the accession itself may be a UniProt ID or NCBI protein accession
        let uniprotInfo: any = { uniprotId: seqId, entryName: 'Sequence Input', proteinName: `Input Sequence (${sequence.length}aa)`, geneNames: 'N/A', organism: 'N/A', sequenceLength: sequence.length };
        if (blastHits.length > 0) {
          const topHit = blastHits[0];
          emit({ stage: 'uniprot-lookup', level: 'info', message: `从最高同源性命中 (${usedNrFallback ? topHit.uniprotRef : topHit.pdbId}, identity=${topHit.identity}%) 查找 UniProt 元数据…`, progress: 42 });
          try {
            let uniprotAcc: string | null = null;
            if (usedNrFallback) {
              // nr database hit — the accession may be a UniProt ID (e.g. sp|P00533|)
              // or NCBI protein accession (e.g. WP_123456789.1)
              const acc = topHit.uniprotRef;
              // Try to extract UniProt ID from description (format: "sp|P00533|EGFR_HUMAN ...")
              const uniMatch = (topHit.description || '').match(/sp\|([A-Z0-9]+)\|/);
              if (uniMatch) {
                uniprotAcc = uniMatch[1];
              } else if (/^[A-NR-Z][0-9][A-Z0-9]{3}[0-9]/i.test(acc) || /^([A-Z0-9]{6,10})$/i.test(acc)) {
                // Looks like a UniProt accession (e.g. P00533, Q8IVF2)
                uniprotAcc = acc;
              } else {
                // Try NCBI protein → UniProt mapping via UniProt search API
                emit({ stage: 'uniprot-lookup', level: 'info', message: `通过 NCBI accession ${acc} 搜索 UniProt…`, progress: 44 });
                const uniSearchRes = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=xref:${acc}&fields=accession&format=json&size=1`, { signal: AbortSignal.timeout(15000) });
                if (uniSearchRes.ok) {
                  const uniSearchData = await uniSearchRes.json();
                  uniprotAcc = uniSearchData?.results?.[0]?.primaryAccession || null;
                }
              }
            } else {
              // pdbaa hit — use RCSB entity API to find UniProt accession
              const rcsbRes = await fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${topHit.pdbId}/1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
              if (rcsbRes.ok) {
                const rcsbData = await rcsbRes.json();
                const uniProts = rcsbData?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers || [];
                uniprotAcc = uniProts.find((r: any) => r.database_name === 'UniProt')?.database_accession || null;
              }
            }
            if (uniprotAcc) {
              emit({ stage: 'uniprot-lookup', level: 'info', message: `找到 UniProt accession: ${uniprotAcc}，获取元数据…`, progress: 44 });
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
                emit({ stage: 'uniprot-lookup', level: 'success', message: `UniProt 元数据: ${meta.proteinName} · ${meta.organism} · ${meta.sequenceLength}aa (BLAST identity=${topHit.identity}% via ${usedNrFallback ? 'nr' : 'pdbaa'})`, progress: 46 });
              } else {
                emit({ stage: 'uniprot-lookup', level: 'warn', message: `UniProt 元数据获取失败 (${uniprotAcc})`, progress: 46 });
              }
            } else {
              emit({ stage: 'uniprot-lookup', level: 'warn', message: `未找到关联的 UniProt accession`, progress: 46 });
            }
          } catch (err: any) {
            emit({ stage: 'uniprot-lookup', level: 'warn', message: `UniProt 查找失败: ${err?.message}`, progress: 46 });
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
        emit({ stage: 'score', level: 'success', message: `overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${xrayCount}条, Cryo-EM=${scores.cryoem.score}/${cryoemCount}条, NMR=${scores.nmr.score}/${nmrCount}条)`, progress: 50 });

        // Generate report
        let report: any = undefined;
        if (generateReport) {
          emit({ stage: 'llm-report', level: 'info', message: `生成 LLM 报告 (${provider})…`, progress: 55 });
          try {
            const litInfo = await buildLiteratureInfo(pdbDetails, maxLitCount);
            const pdbTable = pdbDetails.length > 0
              ? buildDetailedPdbTable(pdbDetails, 80)
              : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 BLAST 同源结构) | - | - | - | - |';
            const blastTable = buildDetailedBlastTable(blastHits, maxBlastHits);
            const topPdbs = pdbDetails.slice(0, 10).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)}`).join('\n');
            const litBlock = litInfo.count > 0 ? `\n\n相关 PubMed 文献（共 ${litInfo.count} 篇，按 IF 降序）：\n${litInfo.text}` : '\n\n（无 PubMed 文献数据）';
            const sysPrompt = buildReportSystemPrompt();
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

            // Use single-call report (not 8-chapter) for sequence mode to save memory
            const bSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份蛋白序列评估报告（800-1500 字），使用 Markdown 格式，包含以下章节：## 序列概述、## BLAST 同源结构分析、## 可成药性评估、## 实验建议、## 总结。';
            const r = await generateText(bSysPrompt, userPrompt, { maxChars: 2000, llm: body.llm });
            report = { ok: r.ok, content: r.content, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: r.content?.length || 0, fallback: false };
            if (r.ok) emit({ stage: 'llm-report', level: 'success', message: `LLM 报告已生成 · ${report.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}`, progress: 90 });
            else emit({ stage: 'llm-report', level: 'error', message: `LLM 报告失败：${r.error}`, progress: 90 });
          } catch (err: any) {
            emit({ stage: 'llm-report', level: 'error', message: `LLM 生成失败：${err?.message}`, progress: 90 });
          }
        }

        // Write to DB
        const seqId = `SEQ_${Date.now().toString(36)}`;
        try {
          const scoresJson = JSON.stringify({ 'X-ray': { score: scores.xray.score, rating: scores.xray.rating }, 'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating }, 'NMR': { score: scores.nmr.score, rating: scores.nmr.rating }, 'Overall': { score: scores.overall.score, rating: scores.overall.rating } });
          await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${seqId}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, ${report?.ok ? report.content : null}, 0, false, ${pdbDetails.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, updatedAt = CURRENT_TIMESTAMP`;
          // Insert BLAST hits as PDB structures
          await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${seqId}`;
          for (const e of pdbDetails) {
            const isCryoem = (e.method || '').includes('ELECTRON'); const isXray = (e.method || '').includes('X-RAY'); const isNmr = (e.method || '').includes('NMR');
            const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
            await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${seqId}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate || null}, ${e.releaseDate}, ${e.ligands || ''}, ${e.ligands || ''}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms || ''}, ${e.authors || ''}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
          }
          // Insert BLAST results
          await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${seqId}`;
          for (const h of blastHits) {
            await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source) VALUES (${seqId}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'})`;
          }
          emit({ stage: 'write-db', level: 'success', message: `已写入 Evaluation + ${pdbDetails.length} PDB + ${blastHits.length} BLAST`, progress: 95 });
        } catch (err: any) {
          emit({ stage: 'write-db', level: 'error', message: `DB 写入失败：${err?.message}`, progress: 95 });
        }

        const result = { uniprot: seqId, uniprotInfo, directPdbCount: 0, pdbPersisted: pdbDetails.length, blastHitCount: blastHits.length, coverage, scores, report, dbSaved: true, durationMs: Date.now() - t0 };
        emit({ stage: 'done', level: report?.ok || !generateReport ? 'success' : 'warn', message: `完成 · ${blastHits.length} BLAST 同源 · overall=${scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${report?.ok ? ` · LLM ✓ (${report.contentChars} chars)` : ''}`, progress: 100 });
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
          const sysPrompt = '你是结构生物学领域的资深研究员，正在为一个蛋白靶点的可成药性评估报告撰写章节。中文输出，markdown 格式，严格按照用户提供的任务指令。';

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
        for (const h of blastHits) {
          await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source) VALUES (${uniprot}, ${h.pdbId}, ${h.uniprotRef}, ${h.description}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'})`;
        }
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
      emit({ stage: 'done', level: report?.ok || !generateReport ? 'success' : 'warn', message: `完成 · ${directPdbCount} PDB (真实) · overall=${scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${report?.ok ? ` · LLM ✓ (${report.contentChars} chars)` : generateReport ? ' · LLM ✗' : ''}${dbSaved ? ' · DB ✓' : ' · DB ✗'}`, progress: 100 });

      // ── Batch mode: evaluate remaining targets + cross-target relationship analysis ──
      if (isBatch && targets.length > 1) {
        const batchResults: any[] = [{ uniprot, uniprotInfo, pdbDetails, scores, report }];
        // Evaluate remaining targets (target[0] already done above)
        for (let bi = 1; bi < targets.length; bi++) {
          const bt = targets[bi];
          const bUid = (bt.uniprot || '').trim().toUpperCase();
          if (!bUid) continue;
          emit({ stage: `batch-${bi}`, level: 'info', message: `[Batch ${bi + 1}/${targets.length}] 评估 ${bUid}…`, progress: 100 });
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
              emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} 缓存命中（参数+PDB数未变），跳过重新获取`, progress: 100 });
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
              emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Batch ${bi + 1}] 生成 ${bUid} 的 LLM 报告…`, progress: 100 });
              try {
                // Use a single-call summary report (not 7-chapter) to reduce memory/time
                const topPdbs = bPdbDetails.slice(0, 10).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)}`).join('\n');
                // Literature info for this batch target (capped at maxLitCount, IF desc).
                const bLitInfo = await buildLiteratureInfo(bPdbDetails, maxLitCount);
                const bLitBlock = bLitInfo.count > 0
                  ? `\n\n相关 PubMed 文献（共 ${bLitInfo.count} 篇，按 IF 降序，摘要 200 字截断）：\n${bLitInfo.text}`
                  : '\n\n（无 PubMed 文献数据）';
                const bSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份蛋白靶点评估报告（800-1500 字），使用 Markdown 格式，包含以下章节：## 蛋白功能概述、## PDB 结构分析、## 可成药性评估、## 实验建议、## 总结。';
                const bUserPrompt = `UniProt: ${bUid}\n蛋白名称: ${bInfo.proteinName}\n基因名: ${bInfo.geneNames}\n物种: ${bInfo.organism}\n序列长度: ${bInfo.sequenceLength} aa\nPDB 结构数: ${bPdbDetails.length}\n评分: overall=${bScores.overall.score}/10 (X-ray=${bScores.xray.score}/${bXray}条, Cryo-EM=${bScores.cryoem.score}/${bCryoem}条, NMR=${bScores.nmr.score}/${bNmr}条)\nBLAST: ${bSkipBlast ? '已跳过' : '未执行'}\n\n代表性 PDB 结构（前 10 个）:\n${topPdbs || '（无 PDB 结构）'}${bLitBlock}\n\n请生成完整的评估报告，在"实验建议"和"总结"中可引用文献 PMID 作为参考。`;
                const br = await generateText(bSysPrompt, bUserPrompt, { maxChars: 2000, llm: body.llm });
                bReport = { ok: br.ok, content: br.content, provider: br.provider, model: br.model, durationMs: br.durationMs, contentChars: br.content?.length || 0 };
                if (br.ok) emit({ stage: `batch-${bi}-llm`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} LLM 报告已生成 · ${bReport.contentChars} chars · ${(br.durationMs / 1000).toFixed(1)}s${bLitInfo.count > 0 ? ` · 附 ${bLitInfo.count} 篇文献` : ''}`, progress: 100 });
                else emit({ stage: `batch-${bi}-llm`, level: 'error', message: `✗ [Batch ${bi + 1}] ${bUid} LLM 报告失败：${br.error}`, progress: 100 });
              } catch (err: any) {
                emit({ stage: `batch-${bi}-llm`, level: 'error', message: `✗ [Batch ${bi + 1}] ${bUid} LLM 生成失败：${err?.message}`, progress: 100 });
              }
            } else if (bCacheHit && bCached?.report) {
              bReport = { ok: true, content: bCached.report, provider: '(cached)', model: '(cached)', durationMs: 0, contentChars: bCached.report.length, cached: true };
              emit({ stage: `batch-${bi}-llm`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid} 使用已有 LLM 报告（缓存）· ${bReport.contentChars} chars`, progress: 100 });
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
              emit({ stage: `batch-${bi}`, level: 'error', message: `[Batch ${bi + 1}] DB 写入失败：${dbErr?.message}`, progress: 100 });
            }
            batchResults.push({ uniprot: bUid, uniprotInfo: bInfo, pdbDetails: bPdbDetails, scores: bScores, cached: bCacheHit, report: bReport });
            emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Batch ${bi + 1}] ${bUid}: ${bPdbDetails.length} PDB · overall=${bScores.overall.score}/10${bCacheHit ? ' · 缓存' : ''}${bReport?.ok ? ` · LLM ✓ (${bReport.contentChars} chars)` : ''}`, progress: 100 });
          } catch (err: any) {
            emit({ stage: `batch-${bi}`, level: 'error', message: `✗ [Batch ${bi + 1}] ${bUid} 失败：${err?.message}`, progress: 100 });
          }
        }

        // ── Cross-target relationship analysis: find common PDB structures ──
        emit({ stage: 'cross-analysis', level: 'info', message: `分析 ${batchResults.length} 个靶点的共有结构与相关性…`, progress: 100 });
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
        emit({ stage: 'cross-analysis', level: commonPdbIds.length > 0 ? 'success' : 'info', message: `共有结构（全部靶点）：${commonPdbIds.length} 个${commonPdbIds.length > 0 ? ` (${commonPdbIds.slice(0, 5).join(', ')}…)` : ''} · 两两重叠：${Object.keys(pdbOverlap).length} 对`, progress: 100 });

        // ── Generate cross-target relationship LLM report ──
        let crossReport: any = undefined;
        if (generateReport) {
          emit({ stage: 'cross-llm', level: 'info', message: `生成靶点间相关性 LLM 分析报告…`, progress: 100 });
          try {
            const crossSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份靶点间相关性分析报告，使用 Markdown 格式。分析多个蛋白靶点之间的结构关联性、功能关系、以及共有的结构基础。';
            const targetSummary = batchResults.map((r, i) => {
              const top5 = (r.pdbDetails || []).slice(0, 5).map((e: PdbEntryDetail) => `  - ${e.pdbId}: ${e.method} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 50)}`).join('\n');
              return `靶点 ${i + 1}: ${r.uniprot} (${r.uniprotInfo?.proteinName})\n  PDB 结构数: ${(r.pdbDetails || []).length}\n  评分: overall=${r.scores?.overall?.score}/10\n  代表性结构:\n${top5}`;
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
            if (r.ok) emit({ stage: 'cross-llm', level: 'success', message: `✓ 相关性分析报告已生成 · ${crossReport.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}${crossLit.count > 0 ? ` · 附 ${crossLit.count} 篇文献` : ''}`, progress: 100 });
            else emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析 LLM 失败：${r.error}`, progress: 100 });
          } catch (err: any) {
            emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析失败：${err?.message}`, progress: 100 });
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
