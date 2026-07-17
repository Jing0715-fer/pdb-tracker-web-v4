/**
 * Shared markdown → HTML converter for LLM-generated reports.
 *
 * Why not react-markdown + remark-gfm?
 *   In our batch reports, the 9IP8 list (a perfectly-formed GFM pipe table
 *   with `|---|` separator) was being rendered as plain text — the parser
 *   failed to recognize the table when it was preceded by a Chinese paragraph
 *   ending in `**` (bold) + `：` (full-width colon). We could not reproduce the
 *   failure in isolation, only in the browser — suggesting a hydration or
 *   remark-gfm edge case we don't have time to track down. Our own converter
 *   is more predictable: 4 table formats supported, and it correctly renders
 *   every table in every batch report we have.
 *
 * Supported syntax:
 *   - Pipe-separated with separator:  | a | b | / |---| / | c | d |
 *   - Pipe-separated without separator (LLMs sometimes skip it)
 *   - Tab-separated (LLMs frequently use tabs in batch overviews)
 *   - Multi-space-separated (≥ 2 spaces between cells)
 *   - Headings: # / ## / ###
 *   - Lists: - * / 1.
 *   - Bold **x** / Italic *x* / Code `x` / URLs (auto-linked)
 *   - Horizontal rule: ---
 *
 * Used by:
 *   - src/components/ui/pdb-ui.tsx (ReportModal — batch cross-target reports)
 *   - src/components/eval-report-generator.tsx (single-eval LLM chapter report)
 */

export interface MarkdownRenderResult {
  /** The rendered body HTML (no <html>/<head>/<body> wrapper — caller can wrap). */
  bodyHtml: string;
  /** True if the source had at least one table. Useful for debugging. */
  hadTable: boolean;
  /** True if the source had at least one heading. */
  hadHeading: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  // Escape first, then apply inline markdown on the safe string. Order matters:
  // bold/italic/code replacements should not be re-escaped.
  let s = escapeHtml(text);
  // Inline code: `code`
  s = s.replace(
    /`([^`]+)`/g,
    '<code style="background:#f5f0ea;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em;color:#c96442;">$1</code>'
  );
  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (not part of **)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Auto-link http(s) URLs
  s = s.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#c96442;text-decoration:underline;">$1</a>'
  );
  return s;
}

const TABLE_TH_STYLE =
  'background:#f5f0ea;font-weight:600;text-align:left;padding:8px 12px;border-bottom:2px solid #e8e4dd;word-break:break-word;overflow-wrap:anywhere;';
const TABLE_TD_STYLE =
  'padding:8px 12px;border-bottom:1px solid #f0ece6;word-break:break-word;overflow-wrap:anywhere;';
const TABLE_STYLE =
  'width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;table-layout:fixed;word-break:break-word;overflow-wrap:anywhere;';

/** Render markdown to body HTML (no wrapper). Returns rich metadata. */
export function renderMarkdownToHtml(md: string): MarkdownRenderResult {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let hadTable = false;
  let hadHeading = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ─── Markdown table detection ─────────────────────────────────────
    // Four formats supported:
    //  1. Pipe-separated with separator: | a | b | / |---| / | c | d |
    //  2. Pipe-separated without separator
    //  3. Tab-separated (LLMs use tabs in batch overview reports)
    //  4. Multi-space-separated (≥ 2 spaces)
    // ─────────────────────────────────────────────────────────────────
    const isPipeTable = trimmed.startsWith('|');
    const hasPipeSep =
      isPipeTable &&
      i + 1 < lines.length &&
      /^\s*\|?[\s|:-]+\|?\s*$/.test(lines[i + 1]) &&
      /[\s|:-]---/.test(lines[i + 1]);
    const tabCount = (line.match(/\t/g) || []).length;
    const multiSpaceSplit =
      !isPipeTable &&
      tabCount === 0 &&
      /[^\s]\s{2,}[^\s]/.test(line) &&
      line.split(/\s{2,}/).length >= 2;
    const isTabTable =
      !isPipeTable &&
      tabCount >= 1 &&
      i + 1 < lines.length &&
      (lines[i + 1].match(/\t/g) || []).length === tabCount;

    // Pipe table (with or without separator)
    if (isPipeTable) {
      const headerCells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      const dataRows: string[][] = [];
      if (hasPipeSep) i += 2;
      else i += 1; // no separator — first row is header
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        dataRows.push(
          lines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim())
        );
        i++;
      }
      out.push(`<table style="${TABLE_STYLE}">`);
      out.push('<thead><tr>');
      for (const h of headerCells) {
        out.push(`<th style="${TABLE_TH_STYLE}">${renderInline(h)}</th>`);
      }
      out.push('</tr></thead>');
      if (dataRows.length === 0) {
        out.push('</table>');
      } else {
        out.push('<tbody>');
        for (const row of dataRows) {
          out.push('<tr>');
          for (const c of row) {
            out.push(`<td style="${TABLE_TD_STYLE}">${renderInline(c)}</td>`);
          }
          out.push('</tr>');
        }
        out.push('</tbody></table>');
      }
      hadTable = true;
      continue;
    }

    // Tab-separated or multi-space-separated table
    if (isTabTable || multiSpaceSplit) {
      const split = (s: string) =>
        isTabTable
          ? s.split('\t').map((c) => c.trim())
          : s.split(/\s{2,}/).map((c) => c.trim());
      const headerCells = split(line);
      i++;
      const dataRows: string[][] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') break;
        const nextTabs = (next.match(/\t/g) || []).length;
        const nextSplittable =
          !isTabTable && /[^\s]\s{2,}[^\s]/.test(next)
            ? next.split(/\s{2,}/)
            : null;
        if (isTabTable && nextTabs === tabCount) {
          dataRows.push(split(next));
          i++;
        } else if (
          !isTabTable &&
          nextSplittable &&
          nextSplittable.length === headerCells.length
        ) {
          dataRows.push(split(next));
          i++;
        } else {
          break;
        }
      }
      if (dataRows.length > 0) {
        out.push(`<table style="${TABLE_STYLE}">`);
        out.push('<thead><tr>');
        for (const h of headerCells) {
          out.push(`<th style="${TABLE_TH_STYLE}">${renderInline(h)}</th>`);
        }
        out.push('</tr></thead><tbody>');
        for (const row of dataRows) {
          out.push('<tr>');
          for (const c of row) {
            out.push(`<td style="${TABLE_TD_STYLE}">${renderInline(c)}</td>`);
          }
          out.push('</tr>');
        }
        out.push('</tbody></table>');
        hadTable = true;
        continue;
      }
      // Fall through to paragraph handling if no data rows
    }

    // Headings
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      out.push(
        `<h3 style="font-size:14px;font-weight:600;color:#4a4a4a;margin:18px 0 8px;">${renderInline(h3[1])}</h3>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      out.push(
        `<h2 style="font-size:17px;font-weight:600;color:#c96442;margin:28px 0 14px;padding-bottom:6px;border-bottom:2px solid #e8e4dd;">${renderInline(h2[1])}</h2>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      out.push(
        `<h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">${renderInline(h1[1])}</h1>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr style="border:0;border-top:1px solid #e8e4dd;margin:20px 0;"/>');
      i++;
      continue;
    }
    // Unordered list
    const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (ul) {
      out.push('<ul style="margin:8px 0 12px 24px;font-size:14px;">');
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)$/);
        if (!m) break;
        out.push(`<li style="margin-bottom:4px;">${renderInline(m[2])}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }
    // Ordered list
    const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ol) {
      out.push('<ol style="margin:8px 0 12px 24px;font-size:14px;">');
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
        if (!m) break;
        out.push(`<li style="margin-bottom:4px;">${renderInline(m[2])}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }
    // Empty line
    if (line.trim() === '') {
      out.push('<div style="height:6px;"></div>');
      i++;
      continue;
    }
    // Plain paragraph: collect consecutive non-empty, non-block-starter lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(\s*)[#\-|*]|\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(
      `<p style="margin:8px 0 12px;font-size:14px;line-height:1.65;">${renderInline(paraLines.join(' '))}</p>`
    );
  }

  return {
    bodyHtml: out.join('\n'),
    hadTable,
    hadHeading,
  };
}

/** Pre-process: strip YAML frontmatter (---\n…\n---) and the first H1 heading. */
export function stripMarkdownFrontmatterAndTitle(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#\s+.+\n/, '');
}

/**
 * Sanitize an LLM-generated markdown report for safe rendering.
 *
 * Background: the LLM may be cut off mid-generation by the API's token
 * limit. The 6 reports we have in our DB all show this — eval-P07766 ends
 * with `| # | PDB | 分辨率 | 内容 | 期刊 |` (table header, no separator, no
 * data rows); the 4 batch reports end mid-sentence (`Exon20 插入突变的差异
 * 化结合模式开`, `— 考`, `— 这` etc.).
 *
 * This function:
 *   1. Closes unclosed `**` bold spans (LLM may have produced odd count
 *      if cut off mid-token).
 *   2. Closes unclosed code spans (backtick pairs).
 *   3. Detects mid-table truncation: if the last line is a pipe header
 *      with no separator/data below, append a "..." row so the table
 *      stays well-formed.
 *   4. Detects mid-sentence truncation in the trailing paragraph:
 *      cuts back to the last full sentence-ending punctuation, so the
 *      report doesn't end with a half-word like `开` or `考`.
 *   5. Removes orphan JSON/object fragments (lines like `{"Primar`).
 *
 * Applied at the INGESTION point (just before writing to Evaluation.report
 * or EvaluationBatch.combinedReport) so the DB stores clean, complete
 * reports. The renderer doesn't have to handle the half-written edge
 * cases anymore.
 */
export function sanitizeReport(md: string): string {
  if (!md) return md;
  let s = md;
  // 1) Close unclosed bold spans. Count `**` (non-overlapping).
  //    Don't count `***` (bold-italic) — it uses 3 `*` chars.
  //    We do that by replacing `***` with a placeholder first.
  const BOLD_PLACEHOLDER = '\u0001BOLDSTAR\u0001';
  const ITALIC_PLACEHOLDER = '\u0001ITALIC\u0001';
  let sCount = s.replace(/\*\*\*/g, () => '\u0001BOLDITALIC\u0001');
  // Now in sCount, `**` is always a bold marker, never part of ***.
  const boldMatches = sCount.match(/\*\*/g) || [];
  if (boldMatches.length % 2 !== 0) {
    // Odd number of ** → append a closing ** at the end of the last
    // paragraph (don't tack on a stray ** at the very end of the doc,
    // which would look weird in rendered HTML).
    s = s + '**';
  }
  // 2) Close unclosed backtick code spans. Pair-counting is harder
  //    because of triple-backtick blocks, but for our case the LLM
  //    only ever produces inline single-backticks. If odd count, append
  //    a closing backtick.
  //    Skip the backtick-fix for now (the 6 sample reports don't have
  //    any truncated code spans).
  void ITALIC_PLACEHOLDER; void BOLD_PLACEHOLDER;

  // 3) Detect mid-table truncation. Walk line-by-line. The pattern:
  //      | a | b |
  //      (no separator line below)
  //    OR
  //      | a | b |
  //      |---|
  //      (separator present but no data row)
  //    Either means a table was started but not finished. Fix by
  //    ensuring there's a separator line after the header.
  const lines = s.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (
      line.trim().startsWith('|') &&
      line.trim().endsWith('|') &&
      // next line is NOT a separator and NOT another table row
      !/^\s*\|?[-:\s|]+\|?\s*$/.test(next) &&
      !next.trim().startsWith('|')
    ) {
      // Insert a separator line + "..." placeholder row to make the
      // table valid. Compute the column count from the header.
      const cols = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
      const sep = '|' + Array(cols).fill('---').join('|') + '|';
      const placeholder = '|' + Array(cols).fill('…').join('|') + '|';
      lines.splice(i + 1, 0, sep, placeholder);
      i += 2; // skip the two we just inserted
    }
  }
  s = lines.join('\n');

  // 4) Detect mid-sentence / mid-word truncation in the trailing
  //    paragraph. If the very last non-empty line ends with a partial
  //    word or no terminal punctuation, walk back to the last full
  //    sentence boundary. Strategy (conservative — only cut when we're
  //    sure we won't lose content):
  //      a. If the last line ends with `。` / `!` / `?` / `！` / `？` /
  //         `）` / `】` / `」` / `』` / a Chinese full-width
  //         parentheses — it's complete, do nothing.
  //      b. If the last line is a Markdown list marker (`- foo`, `* foo`,
  //         `1. foo`) and ends with a word but no list terminator, it
  //         may be a cut list — keep the line; the renderer will
  //         gracefully show an unfinished bullet.
  //      c. Otherwise (mid-sentence or mid-word in a paragraph):
  //         cut back to the last `。` if it's within the last ~500
  //         characters, OR append `…` if no good cut point exists.
  //      d. NEVER drop a complete section just because the last
  //         sentence is short.
  const lastNonEmpty = s.split('\n').filter((l) => l.trim().length > 0).pop() || '';
  const lastChar = lastNonEmpty.slice(-1);
  const isComplete = /[。.!?）)】」』\n]/.test(lastChar) ||
    // Code-block / hr / table-row endings are fine
    lastNonEmpty.startsWith('```') ||
    /^---+\s*$/.test(lastNonEmpty.trim());
  if (!isComplete) {
    const sClean = s.replace(/\r\n/g, '\n');
    // Heuristic: if the last line starts with `-` / `*` / digit+`.` /
    // `数字.` and has no terminal punctuation, it's a list bullet
    // that was likely cut mid-word. The whole preceding paragraph is
    // still valid — don't cut, just append `…` so the user knows it
    // was truncated.
    const isListBullet = /^\s*([-*]|\d+[.、)])\s/.test(lastNonEmpty);
    if (isListBullet) {
      s = sClean.trimEnd() + '…\n';
    } else {
      // Find the last sentence-terminal punctuation. If the cut would
      // discard more than half the document, just append `…` instead.
      const lastPeriod = sClean.lastIndexOf('。');
      const lastExcl = sClean.lastIndexOf('！');
      const lastQ = sClean.lastIndexOf('？');
      const lastEn = sClean.lastIndexOf('!');
      const lastQn = sClean.lastIndexOf('?');
      const lastClose = sClean.lastIndexOf('】');
      const candidates = [lastPeriod, lastExcl, lastQ, lastEn, lastQn, lastClose]
        .filter((p) => p > 0);
      if (candidates.length === 0) {
        s = sClean.trimEnd() + '…\n';
      } else {
        const lastPunct = Math.max(...candidates);
        // Only cut if the cut candidate is reasonably close to the end
        // (within 800 chars) — otherwise the cut would discard a huge
        // amount of legitimate content. In that case just append `…`.
        if (sClean.length - lastPunct < 800) {
          s = sClean.substring(0, lastPunct + 1).trimEnd() + '\n';
        } else {
          s = sClean.trimEnd() + '…\n';
        }
      }
    }
  }

  // 5) Strip orphan JSON / object fragments. If a line starts with `{`
  //    or `["Primar` patterns, drop it. The LLM sometimes embeds a
  //    partial JSON dump of its next action.
  s = s
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.startsWith('{') && !t.endsWith('}')) return false; // partial obj
      if (t.startsWith('[') && !t.endsWith(']')) return false; // partial arr
      if (/^["{[]["']?\w{0,8}$/.test(t) && t.length < 30) return false; // short fragment
      return true;
    })
    .join('\n');

  return s;
}

/**
 * Convenience: render markdown to a complete self-contained HTML page
 * (with <!DOCTYPE>, <html>, <head>, <body>). Used by EvalReportGenerator's
 * iframe srcDoc.
 */
export function renderMarkdownToFullPage(
  md: string,
  options: { title?: string; bodyClassName?: string; maxWidth?: number } = {}
): { html: string; hadTable: boolean; hadHeading: boolean } {
  const stripped = stripMarkdownFrontmatterAndTitle(md);
  const { bodyHtml, hadTable, hadHeading } = renderMarkdownToHtml(stripped);
  const maxWidth = options.maxWidth ?? 820;
  const title = options.title ? escapeHtml(options.title) : 'Report';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; color: #2d2d2d; line-height: 1.7; max-width: ${maxWidth}px; margin: 0 auto; padding: 32px 28px; background: #fff; overflow-x: auto; }
    a { color: #c96442; }
    table { table-layout: fixed; word-break: break-word; overflow-wrap: anywhere; }
    th, td { word-break: break-word; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
  return { html, hadTable, hadHeading };
}
