'use client';

import React, { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Layers, Database, FileSearch, FileText, Share2, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import { LazyMarkdown } from '@/components/lazy-markdown';

interface BatchPreviewContentProps {
  batchId: string;
  onSelectSubTarget: (uniprotId: string) => void;
  selectedSubTargetId: string | null;
  allEvals: Evaluation[];
  batchFetchedEvals: Record<string, Evaluation>;
  evalBatches: any[];
  evalBatchSubTargets: Record<string, any[]>;
  onOpenBatchReport?: (batchId: string, title: string) => void;
}

/** Parse `commonPdbIds` (stored as a JSON-stringified array) into a string[]. */
function parseCommonPdbIds(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean) as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean) as string[];
    } catch {
      // fall through — maybe it's a comma/whitespace-separated list
      return raw.split(/[\s,]+/).filter(Boolean);
    }
  }
  return [];
}

/** Shorten a Markdown report for inline preview. */
function makePreview(md: string | null | undefined, max = 280): string {
  if (!md) return '';
  // Strip Markdown formatting for the preview line.
  const plain = md
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
}

export function BatchPreviewContent({
  batchId,
  onSelectSubTarget,
  selectedSubTargetId,
  allEvals,
  batchFetchedEvals,
  evalBatches,
  evalBatchSubTargets,
  onOpenBatchReport,
}: BatchPreviewContentProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const batch = evalBatches.find((b: any) => b.batchId === batchId);
  const subTargets = evalBatchSubTargets[batchId] || [];
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [showFullBatchReport, setShowFullBatchReport] = useState(false);

  const commonPdbIds = useMemo(() => parseCommonPdbIds(batch?.commonPdbIds), [batch?.commonPdbIds]);

  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-claude-text-muted">
        <p className="text-xs">Batch not found</p>
      </div>
    );
  }

  // Compute batch-level stats
  const totalPdb = subTargets.reduce((sum: number, sub: any) => sum + (sub.pdbCount || 0), 0);
  const totalBlast = subTargets.reduce((sum: number, sub: any) => sum + (sub.blastCount || 0), 0);
  const avgScore = subTargets.length > 0 ? subTargets.reduce((sum: number, sub: any) => sum + (sub.bestScore || 0), 0) / subTargets.length : 0;
  const scoreColor = avgScore >= 80 ? '#2d8f8f' : avgScore >= 50 ? '#c9872e' : avgScore >= 25 ? '#ea580c' : '#dc2626';

  const combinedReport: string = batch.combinedReport || '';
  const targetCount: number = batch.targetCount ?? batch.subTargetCount ?? subTargets.length;
  const crossOk: boolean | null = batch.crossReportOk ?? null;

  return (
    <div className="p-3 space-y-3 max-h-full overflow-y-auto sidebar-scroll">
      {/* ── Batch Hero Card ── */}
      <div className="rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-2.5 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xs font-semibold text-claude-text leading-tight break-words flex-1 min-w-0">{batch.title || 'Batch'}</h2>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex-shrink-0">
            <Layers className="h-2.5 w-2.5 mr-0.5" />{targetCount} targets
          </span>
          {crossOk !== null && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border flex-shrink-0 ${
                crossOk
                  ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40'
              }`}
              title={crossOk ? 'Cross-target report generated successfully' : 'Cross-target report generation failed'}
            >
              {crossOk ? '✓ cross-report' : '✗ cross-report'}
            </span>
          )}
        </div>
        <p className="text-[10px] text-claude-text-muted">Complex Evaluation Group · {batch.batchId}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Database className="h-2.5 w-2.5 text-claude-text-muted" />
            <span className="text-[10px] font-mono font-semibold text-claude-text">{totalPdb}</span>
            <span className="text-[9px] text-claude-text-muted">PDB</span>
          </div>
          <div className="w-px h-2.5 bg-claude-border" />
          <div className="flex items-center gap-0.5">
            <FileSearch className="h-2.5 w-2.5 text-claude-text-muted" />
            <span className="text-[10px] font-mono font-semibold text-claude-text">{totalBlast}</span>
            <span className="text-[9px] text-claude-text-muted">BLAST</span>
          </div>
          <div className="w-px h-2.5 bg-claude-border" />
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] text-claude-text-muted">Score</span>
            <span className="text-[10px] font-mono font-bold" style={{ color: scoreColor }}>{avgScore.toFixed(1)}</span>
          </div>
          {batch.crossReportChars != null && batch.crossReportChars > 0 && (
            <>
              <div className="w-px h-2.5 bg-claude-border" />
              <div className="flex items-center gap-0.5">
                <span className="text-[9px] text-claude-text-muted">Report</span>
                <span className="text-[10px] font-mono font-semibold text-claude-text">{batch.crossReportChars}</span>
                <span className="text-[9px] text-claude-text-muted">chars</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Cross-Target Relationship LLM Report (Markdown) ── */}
      {combinedReport ? (
        <div className="rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-hidden">
          <button
            onClick={() => setShowFullBatchReport((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-claude-border-light/40 dark:hover:bg-[#3d3832]/30 transition-colors"
          >
            {showFullBatchReport ? <ChevronDown className="h-3 w-3 text-claude-text-muted" /> : <ChevronRight className="h-3 w-3 text-claude-text-muted" />}
            <FileText className="h-3 w-3 text-claude-accent" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted flex-1 text-left">
              Cross-Target Relationship Report
            </span>
            <span className="text-[9px] text-claude-text-muted font-mono">{combinedReport.length} chars</span>
          </button>
          {showFullBatchReport ? (
            <div className="px-3 pb-3 pt-1 border-t border-claude-border/40 dark:border-[#3d3832]/40 text-[11px] text-claude-text-secondary max-h-80 overflow-y-auto sidebar-scroll">
              <LazyMarkdown>{combinedReport}</LazyMarkdown>
            </div>
          ) : (
            <div className="px-3 pb-2.5 text-[10px] text-claude-text-muted leading-relaxed">
              {makePreview(combinedReport, 240) || 'No preview available.'}
            </div>
          )}
          {onOpenBatchReport && (
            <button
              onClick={() => onOpenBatchReport(batch.batchId, batch.title || 'Batch Report')}
              className="w-full text-left px-3 py-1.5 text-[10px] text-claude-accent hover:bg-claude-accent-light/20 border-t border-claude-border/40 dark:border-[#3d3832]/40 transition-colors"
            >
              Open full report →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-claude-border dark:border-[#3d3832] p-3 text-center">
          <FileText className="h-4 w-4 text-claude-text-muted mx-auto mb-1 opacity-50" />
          <p className="text-[10px] text-claude-text-muted">No cross-target relationship report generated for this batch.</p>
        </div>
      )}

      {/* ── Common / Shared PDB Structures (from batch.commonPdbIds) ── */}
      {commonPdbIds.length > 0 && (
        <div className="rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5 text-teal-500" />
              Common PDB Structures
            </h4>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/30">
              {commonPdbIds.length} shared across all targets
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto sidebar-scroll">
            {commonPdbIds.map((pdbId) => (
              <a
                key={pdbId}
                href={`https://www.rcsb.org/structure/${pdbId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold border bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800/40 hover:opacity-80 transition-opacity"
              >
                {pdbId}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Sub-targets ── */}
      <div className="rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-purple-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">Sub-targets ({subTargets.length})</span>
        </div>
        <div className="space-y-1.5">
          {subTargets.map((sub: any) => {
            const subEval = allEvals.find(e => e.uniprotId === sub.uniprotId) || batchFetchedEvals[sub.uniprotId];
            const covPct = subEval?.coverage ? Math.min(subEval.coverage, 100) : 0;
            const covColor = covPct >= 80 ? '#2d8f8f' : covPct >= 50 ? '#c9872e' : covPct >= 25 ? '#ea580c' : '#dc2626';
            const subScore = sub.bestScore || 0;
            const subScoreColor = subScore >= 80 ? '#2d8f8f' : subScore >= 50 ? '#c9872e' : subScore >= 25 ? '#ea580c' : '#dc2626';
            const subReport: string = subEval?.report || '';
            const isReportExpanded = expandedReport === sub.uniprotId;
            const isSelected = selectedSubTargetId === sub.uniprotId;
            return (
              <div
                key={sub.uniprotId}
                className={`rounded-lg border transition-all duration-150 ${
                  isSelected
                    ? 'border-claude-accent/40 bg-claude-accent-light/30 dark:bg-[#3d2a22]/30'
                    : 'border-claude-border/50 dark:border-[#3d3832]/50 hover:border-claude-accent/30 hover:bg-claude-border-light/30 dark:hover:bg-[#3d3832]/30'
                }`}
              >
                <div className="flex items-stretch">
                  <button
                    onClick={() => onSelectSubTarget(sub.uniprotId)}
                    className="flex-1 text-left p-2.5 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-claude-accent">{sub.uniprotId}</span>
                          {sub.geneName && <span className="text-[10px] text-claude-text-muted">({sub.geneName})</span>}
                        </div>
                        <div className="text-[10px] text-claude-text-muted truncate mt-0.5">{sub.proteinName || subEval?.proteinName || '-'}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] text-claude-text-muted">
                            <span className="font-mono font-semibold">{sub.pdbCount || 0}</span> PDB
                          </span>
                          <span className="text-[9px] text-claude-text-muted">
                            <span className="font-mono font-semibold">{sub.blastCount || 0}</span> BLAST
                          </span>
                          {covPct > 0 && (
                            <span className="text-[9px] font-mono" style={{ color: covColor }}>Cov {covPct.toFixed(0)}%</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end flex-shrink-0">
                        {subScore > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="w-8 h-1.5 rounded-full bg-claude-border dark:bg-[#3d3832] overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(subScore, 100)}%`, backgroundColor: subScoreColor }} />
                            </div>
                            <span className="text-[10px] font-mono font-bold" style={{ color: subScoreColor }}>{subScore.toFixed(1)}</span>
                          </div>
                        )}
                        {isSelected && (
                          <span className="text-[9px] text-claude-accent mt-1">Viewing</span>
                        )}
                      </div>
                    </div>
                  </button>
                  {subReport && (
                    <button
                      onClick={() => setExpandedReport(isReportExpanded ? null : sub.uniprotId)}
                      className="px-2 border-l border-claude-border/40 dark:border-[#3d3832]/40 text-claude-text-muted hover:text-claude-accent hover:bg-claude-border-light/30 dark:hover:bg-[#3d3832]/30 transition-colors"
                      title={isReportExpanded ? 'Hide individual report' : 'Show individual report'}
                    >
                      {isReportExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                  )}
                </div>
                {isReportExpanded && subReport && (
                  <div className="px-3 pb-3 pt-1 border-t border-claude-border/40 dark:border-[#3d3832]/40 text-[11px] text-claude-text-secondary max-h-64 overflow-y-auto sidebar-scroll">
                    <LazyMarkdown>{subReport}</LazyMarkdown>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Computed Shared Structures (across 2+ targets) ── */}
      {(() => {
        const batchEvals = subTargets.map((sub: any) => allEvals.find((e: Evaluation) => e.uniprotId === sub.uniprotId)).filter(Boolean) as Evaluation[];
        if (batchEvals.length < 2) return null;
        const sharedMap = new Map<string, number>();
        batchEvals.forEach((ev: Evaluation) => {
          const pdbIds = new Set((ev.pdbStructures || []).map((s: any) => s.pdbId));
          pdbIds.forEach(pdbId => {
            sharedMap.set(pdbId, (sharedMap.get(pdbId) || 0) + 1);
          });
        });
        const sharedEntries = Array.from(sharedMap.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const sharedOnly = sharedEntries.filter(([, count]) => count > 1);
        if (sharedOnly.length === 0) return null;
        const getSharedColor = (count: number) => {
          if (count >= 4) return { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800/40' };
          if (count === 3) return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800/40' };
          return { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-800/40' };
        };
        return (
          <div className="rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-claude-text">
                Computed Shared Structures <span className="text-claude-text-muted font-normal">({sharedOnly.length})</span>
              </h4>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/30">
                across 2+ targets
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {sharedOnly.map(([pdbId, count]) => {
                const colors = getSharedColor(count);
                return (
                  <a
                    key={pdbId}
                    href={`https://www.rcsb.org/structure/${pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${colors.bg} ${colors.text} ${colors.border} hover:opacity-80 transition-opacity`}
                  >
                    {pdbId}
                    <span className="text-[8px] font-normal opacity-70">×{count}</span>
                  </a>
                );
              })}
            </div>
            <div className="flex items-center gap-3 text-[9px] text-claude-text-muted pt-1 border-t border-claude-border/30 dark:border-[#3d3832]/30">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-400" /> 2 targets</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400" /> 3 targets</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400" /> 4+ targets</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
