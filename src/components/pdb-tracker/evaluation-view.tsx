'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowRightLeft, LayoutDashboard, Clock, Database, FlaskConical, CheckCircle2, Target,
  Layers, FileText, Share2, ExternalLink, Box, Info, ArrowUpRight, Dna, Microscope, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard, CircularProgress, MiniBar } from '@/components/ui/stat-card';
import { LazyMarkdown } from '@/components/lazy-markdown';
import type { Evaluation, EvalBatch, EvalBatchSubTarget, EvalPdbStructure } from '@/lib/pdb-types';
import type { EvaluationViewProps } from './types';

// Dynamic imports for heavy components (recharts/cmdk-based)
const EvaluationPage = dynamic(() => import('@/components/evaluation-page').then(m => ({ default: m.EvaluationPage })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalComparison = dynamic(() => import('@/components/eval-comparison').then(m => ({ default: m.EvalComparison })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalBatchCompare = dynamic(() => import('@/components/EvalBatchCompare').then(m => ({ default: m.EvalBatchCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalDashboard = dynamic(() => import('@/components/eval-dashboard').then(m => ({ default: m.EvalDashboard })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalGanttTimeline = dynamic(() => import('@/components/eval-gantt-timeline').then(m => ({ default: m.EvalGanttTimeline })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

// StatCard, CircularProgress, sparkline, trend utilities now imported from @/components/ui/stat-card

// ─── Compact Eval Stat Cards ──────────────────────────────────────────────────
// Matches the same overview → separator → action bar pattern as Weekly & Literature

function EvalStatCards({ evaluations, evalBatches, evalLoading }: {
  evaluations: Evaluation[];
  evalBatches: EvalBatch[];
  evalLoading: boolean;
}) {
  const totalEvals = evaluations.length;
  const totalBatches = evalBatches.length;

  const avgCoverage = useMemo(() => {
    const withCoverage = evaluations.filter(e => e.coverage != null);
    if (withCoverage.length === 0) return 0;
    return withCoverage.reduce((sum, e) => sum + (e.coverage ?? 0), 0) / withCoverage.length;
  }, [evaluations]);

  const highCoverageCount = evaluations.filter(e => (e.coverage ?? 0) >= 80).length;

  const highCoveragePct = totalEvals > 0 ? (highCoverageCount / totalEvals) * 100 : 0;

  const completionRate = useMemo(() => {
    if (totalEvals === 0) return 0;
    const completedCount = evaluations.filter(e => {
      const hasPdb = (e.pdbStructures?.length ?? 0) > 0;
      const hasBlast = (e.blastResults?.length ?? 0) > 0;
      const hasReport = !!e.report;
      return hasPdb && hasBlast && hasReport;
    }).length;
    return (completedCount / totalEvals) * 100;
  }, [evaluations, totalEvals]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0 stagger-list">
      {/* Eval Targets — completion rate ring */}
      <StatCard
        title="Eval Targets"
        value={totalEvals}
        icon={<FlaskConical className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b]"
        glowColor="#2d8f8f"
        subtitle={`${totalBatches} batch${totalBatches !== 1 ? 'es' : ''} · ${completionRate.toFixed(0)}% done`}
        loading={evalLoading}
        delay={0}
        borderColor="#2d8f8f"
        tooltip={`Eval Targets: ${totalEvals} (${completionRate.toFixed(0)}% complete, ${totalBatches} batches)`}
      >
        <CircularProgress value={completionRate} max={100} color="#2d8f8f" size={28} />
      </StatCard>

      {/* Batches — mini bar showing batch density */}
      <StatCard
        title="Batches"
        value={totalBatches}
        icon={<Database className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#c9872e] to-[#a06b1a]"
        glowColor="#c9872e"
        subtitle={`${totalEvals} evals · ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)} avg`}
        loading={evalLoading}
        delay={80}
        borderColor="#c9872e"
        tooltip={`Batches: ${totalBatches} (${totalEvals} evaluations, avg ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)} evals/batch)`}
      >
        <MiniBar value={totalBatches > 0 ? Math.min((totalBatches / Math.max(totalEvals, 1)) * 100 * 3, 100) : 0} max={100} color="#c9872e" width={40} height={5} />
      </StatCard>

      {/* Avg Coverage — coverage ring */}
      <StatCard
        title="Avg Coverage"
        value={avgCoverage}
        suffix="%"
        decimals={0}
        icon={<Target className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99]"
        glowColor="#7c5cbf"
        subtitle={`${highCoverageCount} high (≥80%)`}
        loading={evalLoading}
        delay={160}
        borderColor="#7c5cbf"
        tooltip={`Avg Coverage: ${avgCoverage.toFixed(1)}% (${highCoverageCount} high ≥80%)`}
      >
        <CircularProgress value={avgCoverage} max={100} color="#7c5cbf" size={28} />
      </StatCard>

      {/* ≥80% Coverage — mini bar */}
      <StatCard
        title="≥80% Coverage"
        value={highCoverageCount}
        icon={<CheckCircle2 className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#16a34a] to-[#0d7a35]"
        glowColor="#16a34a"
        subtitle={totalEvals > 0 ? `${((highCoverageCount / totalEvals) * 100).toFixed(0)}% of total` : 'No data'}
        loading={evalLoading}
        delay={240}
        borderColor="#16a34a"
        tooltip={`High Coverage: ${highCoverageCount} targets ≥80% (${totalEvals > 0 ? ((highCoverageCount / totalEvals) * 100).toFixed(0) : 0}%)`}
      >
        <MiniBar value={highCoveragePct} max={100} color="#16a34a" width={40} height={5} />
      </StatCard>
    </div>
  );
}

// ─── BatchDetailView ─────────────────────────────────────────────────────────
// Tabbed batch detail mirroring the individual-eval detail layout. Replaces the
// legacy card-based `BatchPreviewContent` rendering when a batch is selected.

type BatchDetailTab = 'Summary' | 'Common Structures' | 'Sub-Targets' | 'Report';

/** Parse `commonPdbIds` (stored as a JSON-stringified array) into a string[]. */
function parseCommonPdbIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean) as string[];
  } catch {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

interface BatchDetailViewProps {
  batchId: string;
  allEvals: Evaluation[];
  batchFetchedEvals: Record<string, Evaluation>;
  evalBatches: EvalBatch[];
  evalBatchSubTargets: Record<string, EvalBatchSubTarget[]>;
  onSelectSubTarget: (uniprotId: string) => void;
  onOpenBatchReport?: (batchId: string, title: string) => void;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#2d8f8f';
  if (score >= 50) return '#c9872e';
  if (score >= 25) return '#ea580c';
  return '#dc2626';
}

function BatchDetailView({
  batchId,
  allEvals,
  batchFetchedEvals,
  evalBatches,
  evalBatchSubTargets,
  onSelectSubTarget,
  onOpenBatchReport,
}: BatchDetailViewProps) {
  const [activeTab, setActiveTab] = useState<BatchDetailTab>('Summary');

  const batch = evalBatches.find(b => b.batchId === batchId);
  const subTargets = evalBatchSubTargets[batchId] || [];

  const commonPdbIds = useMemo(() => parseCommonPdbIds(batch?.commonPdbIds), [batch?.commonPdbIds]);
  const combinedReport = batch?.combinedReport || '';

  // Resolve each sub-target's Evaluation object (from allEvals or batchFetchedEvals).
  const subTargetEvals = useMemo(() => {
    return subTargets.map(sub => {
      const evalObj = allEvals.find(e => e.uniprotId === sub.uniprotId) || batchFetchedEvals[sub.uniprotId];
      return { sub, eval: evalObj };
    });
  }, [subTargets, allEvals, batchFetchedEvals]);

  // For each common PDB ID, find which sub-targets share it and grab structure details.
  const commonStructures = useMemo(() => {
    return commonPdbIds.map(pdbId => {
      const holders: { uniprotId: string; geneName: string }[] = [];
      let structure: EvalPdbStructure | undefined;
      for (const { sub, eval: evalObj } of subTargetEvals) {
        if (!evalObj) continue;
        const found = (evalObj.pdbStructures || []).find(s => s.pdbId === pdbId);
        if (found) {
          holders.push({ uniprotId: sub.uniprotId, geneName: sub.geneName || '' });
          if (!structure) structure = found;
        }
      }
      return { pdbId, holders, structure };
    });
  }, [commonPdbIds, subTargetEvals]);

  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-claude-text-muted">
        <Layers className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-xs">Batch not found</p>
      </div>
    );
  }

  // Batch-level aggregate stats
  const totalPdb = subTargets.reduce((sum, sub) => sum + (sub.pdbCount || 0), 0);
  const totalBlast = subTargets.reduce((sum, sub) => sum + (sub.blastCount || 0), 0);
  const avgScore = subTargets.length > 0
    ? subTargets.reduce((sum, sub) => sum + (sub.bestScore || 0), 0) / subTargets.length
    : 0;
  const avgCov = subTargetEvals.length > 0
    ? subTargetEvals.reduce((sum, { eval: ev }) => sum + (ev?.coverage ?? 0), 0) / subTargetEvals.length
    : 0;
  const scoreColor = getScoreColor(avgScore);
  const targetCount = batch.targetCount ?? batch.subTargetCount ?? subTargets.length;
  const crossOk: boolean | null = batch.crossReportOk ?? null;

  const tabs: BatchDetailTab[] = ['Summary', 'Common Structures', 'Sub-Targets', 'Report'];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Batch Header ── */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <Layers className="h-4 w-4 text-claude-accent flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-claude-text truncate">{batch.title || 'Batch'}</h2>
          <p className="text-[10px] text-claude-text-muted">Complex Evaluation Group · {batch.batchId}</p>
        </div>
        <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/40 text-[10px] font-semibold">
          <Layers className="h-2.5 w-2.5" />
          {targetCount} target{targetCount !== 1 ? 's' : ''}
        </Badge>
        {crossOk !== null && (
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold ${
              crossOk
                ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40'
            }`}
          >
            {crossOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Info className="h-2.5 w-2.5" />}
            {crossOk ? 'cross-report OK' : 'cross-report failed'}
          </Badge>
        )}
      </div>

      {/* ── Tab Buttons ── */}
      <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`h-7 px-3 text-[11px] font-medium rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-claude-accent/10 text-claude-accent'
                : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/40 dark:hover:bg-[#3d3832]/30'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll p-4 space-y-4">
        {activeTab === 'Summary' && (
          <div className="space-y-4">
            {/* Hero / overview */}
            <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4 space-y-2">
              <div className="flex items-start gap-2">
                <Box className="h-4 w-4 text-claude-accent mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-claude-text">{batch.title || 'Untitled Batch'}</h3>
                  <p className="text-[11px] text-claude-text-muted mt-1 leading-relaxed">
                    This batch groups {targetCount} protein target{targetCount !== 1 ? 's' : ''} for cross-target
                    structural comparison. A combined LLM relationship report{' '}
                    {combinedReport ? (
                      <span className="text-teal-600 dark:text-teal-400 font-medium">is available</span>
                    ) : (
                      <span className="text-claude-text-muted font-medium">was not generated</span>
                    )}
                    {commonPdbIds.length > 0 && (
                      <> — {commonPdbIds.length} PDB structure{commonPdbIds.length !== 1 ? 's are' : ' is'} shared across all targets.</>
                    )}.
                  </p>
                </div>
              </div>
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                  <Layers className="h-3 w-3" /> Targets
                </div>
                <div className="text-lg font-bold text-claude-text font-mono mt-1">{targetCount}</div>
                <div className="text-[9px] text-claude-text-muted mt-0.5">{subTargets.length} listed</div>
              </div>
              <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                  <Database className="h-3 w-3" /> Total PDB
                </div>
                <div className="text-lg font-bold text-claude-text font-mono mt-1">{totalPdb}</div>
                <div className="text-[9px] text-claude-text-muted mt-0.5">{totalBlast} BLAST hits</div>
              </div>
              <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                  <Share2 className="h-3 w-3" /> Common PDB
                </div>
                <div className="text-lg font-bold text-claude-text font-mono mt-1">{commonPdbIds.length}</div>
                <div className="text-[9px] text-claude-text-muted mt-0.5">shared across targets</div>
              </div>
              <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                  <BarChart3 className="h-3 w-3" /> Avg Score
                </div>
                <div className="text-lg font-bold font-mono mt-1" style={{ color: scoreColor }}>
                  {avgScore.toFixed(1)}
                </div>
                <div className="text-[9px] text-claude-text-muted mt-0.5">avg cov {avgCov.toFixed(0)}%</div>
              </div>
            </div>

            {/* Cross-report status */}
            <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 flex items-start gap-2">
              <FileText className="h-3.5 w-3.5 text-claude-accent mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-claude-text">Cross-Target Report</span>
                  {crossOk === null ? (
                    <Badge variant="outline" className="text-[9px] text-claude-text-muted">N/A</Badge>
                  ) : crossOk ? (
                    <Badge variant="outline" className="text-[9px] bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Ready
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40">
                      Failed
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-claude-text-muted mt-0.5">
                  {combinedReport
                    ? `${combinedReport.length} chars · generated by LLM`
                    : 'No cross-target relationship report was generated for this batch.'}
                </p>
                {combinedReport && (
                  <button
                    onClick={() => onOpenBatchReport?.(batch.batchId, batch.title || 'Batch Report')}
                    className="text-[10px] text-claude-accent hover:underline mt-1.5 inline-flex items-center gap-1"
                  >
                    Open full report <ArrowUpRight className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Common Structures' && (
          <div className="space-y-4">
            {commonPdbIds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-claude-text-muted">
                <Share2 className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs">No common PDB structures recorded for this batch.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5 text-teal-500" />
                    Shared Structures ({commonPdbIds.length})
                  </h3>
                  <span className="text-[10px] text-claude-text-muted">
                    Present in every sub-target evaluation
                  </span>
                </div>

                {/* Common PDB structures table */}
                <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-hidden">
                  <div className="grid grid-cols-[100px_90px_90px_1fr] gap-2 px-3 py-2 bg-claude-border-light/40 dark:bg-[#3d3832]/30 text-[9px] uppercase tracking-wider text-claude-text-muted font-semibold border-b border-claude-border dark:border-[#3d3832]">
                    <span>PDB ID</span>
                    <span>Method</span>
                    <span>Res. (Å)</span>
                    <span>Shared By</span>
                  </div>
                  <div className="max-h-[40vh] overflow-y-auto sidebar-scroll">
                    {commonStructures.map(({ pdbId, holders, structure }) => (
                      <div
                        key={pdbId}
                        className="grid grid-cols-[100px_90px_90px_1fr] gap-2 px-3 py-2 items-center text-[11px] border-b border-claude-border/40 dark:border-[#3d3832]/40 last:border-b-0 hover:bg-claude-border-light/30 dark:hover:bg-[#3d3832]/20"
                      >
                        <a
                          href={`https://www.rcsb.org/structure/${pdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-bold text-claude-accent hover:underline inline-flex items-center gap-1"
                        >
                          {pdbId}
                          <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                        </a>
                        <span className="text-claude-text-secondary text-[10px]">
                          {structure?.method || '-'}
                        </span>
                        <span className="text-claude-text-secondary text-[10px] font-mono">
                          {structure?.resolution != null ? structure.resolution.toFixed(2) : '-'}
                        </span>
                        <div className="flex flex-wrap gap-1 min-w-0">
                          {holders.length === 0 ? (
                            <span className="text-[10px] text-claude-text-muted italic">No matching structures found</span>
                          ) : (
                            holders.map(h => (
                              <button
                                key={h.uniprotId}
                                onClick={() => onSelectSubTarget(h.uniprotId)}
                                className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold border bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40 hover:opacity-80 transition-opacity"
                                title={h.geneName ? `Open ${h.uniprotId} (${h.geneName})` : `Open ${h.uniprotId}`}
                              >
                                {h.uniprotId}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sub-target PDB counts */}
                <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 space-y-2">
                  <h4 className="text-[11px] font-semibold text-claude-text flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-claude-accent" />
                    Per-Target PDB Counts
                  </h4>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto sidebar-scroll">
                    {subTargets.map(sub => {
                      const pct = totalPdb > 0 ? Math.min((sub.pdbCount / totalPdb) * 100, 100) : 0;
                      return (
                        <div key={sub.uniprotId} className="flex items-center gap-2">
                          <button
                            onClick={() => onSelectSubTarget(sub.uniprotId)}
                            className="font-mono text-[10px] font-semibold text-claude-accent hover:underline w-16 text-left truncate"
                            title={sub.proteinName || sub.uniprotId}
                          >
                            {sub.uniprotId}
                          </button>
                          <div className="flex-1 h-2 rounded-full bg-claude-border dark:bg-[#3d3832] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-teal-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono font-semibold text-claude-text w-8 text-right">
                            {sub.pdbCount || 0}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'Sub-Targets' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
                <Dna className="h-3.5 w-3.5 text-claude-accent" />
                Sub-Targets ({subTargets.length})
              </h3>
              <span className="text-[10px] text-claude-text-muted">Click any target to open its individual evaluation</span>
            </div>

            {subTargets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-claude-text-muted">
                <Dna className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs">No sub-targets recorded for this batch.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {subTargets.map(sub => {
                  const subEval = allEvals.find(e => e.uniprotId === sub.uniprotId) || batchFetchedEvals[sub.uniprotId];
                  const covPct = subEval?.coverage ? Math.min(subEval.coverage, 100) : 0;
                  const covColor = getScoreColor(covPct);
                  const subScore = sub.bestScore || 0;
                  const subScoreColor = getScoreColor(subScore);
                  return (
                    <button
                      key={sub.uniprotId}
                      onClick={() => onSelectSubTarget(sub.uniprotId)}
                      className="w-full text-left rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:border-claude-accent/40 hover:bg-claude-accent-light/20 dark:hover:bg-[#3d2a22]/30 transition-colors p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-claude-accent">{sub.uniprotId}</span>
                            {sub.geneName && <span className="text-[10px] text-claude-text-muted">({sub.geneName})</span>}
                            {sub.organism && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-claude-border-light/50 dark:bg-[#3d3832]/40 text-claude-text-muted truncate max-w-[120px]">
                                {sub.organism}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-claude-text-muted truncate mt-0.5">
                            {sub.proteinName || subEval?.proteinName || '-'}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[9px] text-claude-text-muted inline-flex items-center gap-0.5">
                              <Box className="h-2.5 w-2.5" />
                              <span className="font-mono font-semibold text-claude-text">{sub.pdbCount || 0}</span> PDB
                            </span>
                            <span className="text-[9px] text-claude-text-muted inline-flex items-center gap-0.5">
                              <Microscope className="h-2.5 w-2.5" />
                              <span className="font-mono font-semibold text-claude-text">{sub.blastCount || 0}</span> BLAST
                            </span>
                            {covPct > 0 && (
                              <span className="text-[9px] font-mono" style={{ color: covColor }}>Cov {covPct.toFixed(0)}%</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          {subScore > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-10 h-1.5 rounded-full bg-claude-border dark:bg-[#3d3832] overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(subScore, 100)}%`, backgroundColor: subScoreColor }} />
                              </div>
                              <span className="text-[10px] font-mono font-bold" style={{ color: subScoreColor }}>
                                {subScore.toFixed(1)}
                              </span>
                            </div>
                          )}
                          <span className="text-[9px] text-claude-accent mt-1 inline-flex items-center gap-0.5">
                            Open <ArrowUpRight className="h-2.5 w-2.5" />
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Report' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-claude-accent" />
                Cross-Target Relationship Report
              </h3>
              {combinedReport && onOpenBatchReport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenBatchReport(batch.batchId, batch.title || 'Batch Report')}
                  className="h-7 px-2.5 text-[11px] border-claude-accent/30 text-claude-accent hover:bg-claude-accent/10"
                >
                  Open Full Report <ArrowUpRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>

            {combinedReport ? (
              <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4">
                <div className="text-[10px] text-claude-text-muted mb-3 flex items-center gap-2">
                  <span className="font-mono">{combinedReport.length} chars</span>
                  <span>·</span>
                  <span>generated by LLM</span>
                </div>
                <div className="text-[12px] text-claude-text-secondary leading-relaxed">
                  <LazyMarkdown>{combinedReport}</LazyMarkdown>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-8 text-center">
                <FileText className="h-8 w-8 text-claude-text-muted mx-auto mb-2 opacity-40" />
                <p className="text-xs text-claude-text-muted">
                  No cross-target relationship report was generated for this batch.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function EvaluationView({
  evaluations,
  allEvaluations,
  evalBatches,
  batchSubTargets,
  selectedEvalId,
  selectedEval,
  evalLoading,
  evalSubView,
  evalDetailTab,
  selectedEvalStructure,
  evalReportContent,
  detailPanelOpen,
  onSelectEvalId,
  onSetEvalSubView,
  onSetEvalDetailTab,
  onSetSelectedEvalStructure,
  selectedBatchId,
  batchFetchedEvals,
  onSelectSubTarget,
  onOpenBatchReport,
}: EvaluationViewProps) {
  // Sub-view: toolbar + full-width component
  const currentSubView: string = evalSubView;
  if (evalSubView === 'compare' || evalSubView === 'dashboard' || evalSubView === 'timeline' || evalSubView === 'batch') {
    return (
      <div className="flex flex-col h-full">
        {/* Sub-view navigation bar */}
        <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetEvalSubView('default')}
            className="h-7 px-2.5 text-[11px] text-claude-text-secondary hover:text-claude-text"
          >
            ← Back to Evaluation
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('compare')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'compare' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <ArrowRightLeft className="h-3 w-3 mr-1" />
              Compare
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('dashboard')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'dashboard' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <LayoutDashboard className="h-3 w-3 mr-1" />
              Dashboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('timeline')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'timeline' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <Clock className="h-3 w-3 mr-1" />
              Timeline
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('batch')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'batch' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <Database className="h-3 w-3 mr-1" />
              Batch Matrix
            </Button>
          </div>
        </div>
        {/* Sub-view content */}
        <div className="flex-1 min-h-0">
          {evalSubView === 'compare' && <EvalComparison evaluations={allEvaluations} />}
          {evalSubView === 'dashboard' && (
            <EvalDashboard
              evaluations={allEvaluations}
              batches={evalBatches}
              batchSubTargets={batchSubTargets}
              onViewBatch={(batchId) => { onSetEvalSubView('batch'); void batchId; }}
            />
          )}
          {evalSubView === 'timeline' && (
            <EvalGanttTimeline
              evaluations={allEvaluations}
              onSelectEval={(id) => { onSelectEvalId(id); }}
              selectedUniprotId={selectedEvalId}
            />
          )}
          {evalSubView === 'batch' && (
            <EvalBatchCompare
              evaluations={allEvaluations}
              batches={evalBatches}
              batchSubTargets={batchSubTargets}
            />
          )}
        </div>
      </div>
    );
  }

  // Default: individual evaluation page with overview → separator → action bar pattern
  return (
    <>
      {/* Overview stat cards — same pattern as Weekly & Literature */}
      <EvalStatCards evaluations={allEvaluations} evalBatches={evalBatches} evalLoading={evalLoading} />

      {/* Colored separator — same gradient as Weekly & Literature: after overview, before action bar */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Compare + Dashboard + Timeline toggle buttons — white bg same as Weekly & Literature */}
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('compare')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'compare' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <ArrowRightLeft className="h-3 w-3 mr-1" />
          Compare
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('dashboard')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'dashboard' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <LayoutDashboard className="h-3 w-3 mr-1" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('timeline')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'timeline' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Clock className="h-3 w-3 mr-1" />
          Timeline
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('batch')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'batch' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Database className="h-3 w-3 mr-1" />
          Batch Matrix
        </Button>
        {selectedBatchId && !selectedEvalId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectEvalId(null)}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted ml-auto"
            title="Exit batch detail"
          >
            ← Back to list
          </Button>
        )}
      </div>
      {/* When a batch is selected and no individual sub-target is open, show the
          batch-level preview (common PDB IDs, cross-target LLM report, sub-target
          list with their individual reports). Otherwise fall back to the regular
          individual-eval detail page. */}
      {selectedBatchId && !selectedEvalId ? (
        <BatchDetailView
          batchId={selectedBatchId}
          allEvals={allEvaluations}
          batchFetchedEvals={batchFetchedEvals || {}}
          evalBatches={evalBatches}
          evalBatchSubTargets={batchSubTargets}
          onSelectSubTarget={(uniprotId) => {
            if (onSelectSubTarget) {
              onSelectSubTarget(uniprotId);
            } else {
              onSelectEvalId(uniprotId);
            }
          }}
          onOpenBatchReport={onOpenBatchReport}
        />
      ) : (
        <EvaluationPage
          evaluation={selectedEval}
          loading={evalLoading}
          selectedPdbId={selectedEvalStructure?.pdbId ?? null}
          onSelectPdb={(pdbId) => {
            if (!selectedEval) return;
            // Find the matching EvalRow from pdbStructures or blastResults
            const structRow = selectedEval.pdbStructures.find(s => s.pdbId === pdbId);
            if (structRow) {
              onSetSelectedEvalStructure({ ...structRow, _type: 'structure' });
              return;
            }
            const blastRow = selectedEval.blastResults.find(b => b.pdbId === pdbId);
            if (blastRow) {
              onSetSelectedEvalStructure({
                ...blastRow,
                _type: 'blast',
                ifTier: blastRow.ifTier || '',
                journalIf: blastRow.journalIf ?? null,
                title: blastRow.title || blastRow.description || null,
                releaseDate: blastRow.releaseDate || null,
                pubmedId: blastRow.pubmedId || null,
                pubmedTitle: blastRow.pubmedTitle || null,
                pubmedAuthors: blastRow.pubmedAuthors || null,
                pubmedAbstract: blastRow.pubmedAbstract || null,
              });
            }
          }}
        />
      )}
    </>
  );
}
