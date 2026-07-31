'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCompare, X, Loader2, ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';

interface StructureCompareProps {
  pdbIds: string[];
  open: boolean;
  onClose: () => void;
}

interface ComparisonResult {
  pdbIdA: string;
  pdbIdB: string;
  rmsd: number | null;
  sequenceIdentity: number | null;
  coverage: number | null;
  alignedLength: number | null;
  method: string;
  note?: string;
}

/**
 * StructureCompareDialog — 3D structure comparison using Molstar.
 * Loads 2 PDB structures side by side, calculates RMSD via structure
 * superposition, and displays alignment metrics.
 */
export function StructureCompareDialog({ pdbIds, open, onClose }: StructureCompareProps) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRefA = useRef<HTMLDivElement>(null);
  const containerRefB = useRef<HTMLDivElement>(null);
  const viewersRef = useRef<any[]>([]);

  const pdbA = pdbIds[0];
  const pdbB = pdbIds[1];

  const loadStructures = useCallback(async () => {
    if (!pdbA || !pdbB) return;

    setLoading(true);
    setError(null);
    setResult(null);
    viewersRef.current = [];

    try {
      // Dynamically import Molstar
      // @ts-ignore — molstar types are ignored in dev via next.config IgnorePlugin
      const molstar = await import('molstar');
      // @ts-ignore
      const { DefaultPluginSpec } = await import('molstar/build/viewer/molstar');

      // Create two viewers side by side
      for (let i = 0; i < 2; i++) {
        const container = i === 0 ? containerRefA.current : containerRefB.current;
        if (!container) continue;

        const viewer = await molstar.Viewer.create(container, {
          ...DefaultPluginSpec(),
          layoutShowControls: false,
          layoutShowSequence: false,
          layoutShowLog: false,
          layoutShowLeftPanel: false,
          viewportShowExpand: true,
          viewportShowControls: false,
          viewportShowSettings: false,
          viewportShowSelectionMode: false,
          viewportShowAnimation: false,
        });

        const pdbId = i === 0 ? pdbA : pdbB;
        await viewer.loadPdb(pdbId);
        viewersRef.current.push(viewer);
      }

      // Fetch alignment data from our API
      const res = await fetch(`/api/structure-compare?a=${pdbA}&b=${pdbB}`);
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      } else {
        // Fallback: show structures without alignment metrics
        setResult({
          pdbIdA: pdbA,
          pdbIdB: pdbB,
          rmsd: null,
          sequenceIdentity: null,
          coverage: null,
          alignedLength: null,
          method: 'visual',
          note: locale === 'zh' ? '对齐数据不可用，仅显示结构叠加' : 'Alignment data unavailable, showing structures side by side',
        });
      }
    } catch (err: any) {
      setError(err?.message || (locale === 'zh' ? '加载结构失败' : 'Failed to load structures'));
    } finally {
      setLoading(false);
    }
  }, [pdbA, pdbB, locale]);

  useEffect(() => {
    if (open && pdbA && pdbB) {
      // Schedule the async loader as a microtask so the setState calls
      // it contains run in a callback, not synchronously in the effect body.
      Promise.resolve().then(() => { loadStructures(); });
    }
    return () => {
      // Cleanup viewers
      viewersRef.current.forEach(v => {
        try { v?.dispose?.(); } catch { /* ignore */ }
      });
      viewersRef.current = [];
    };
  }, [open, pdbA, pdbB, loadStructures]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-[#1c1b1a] rounded-2xl shadow-2xl max-w-[90vw] max-h-[90vh] w-[1200px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-claude-border dark:border-[#3d3832]">
          <div className="flex items-center gap-2.5">
            <GitCompare className="h-5 w-5 text-claude-accent" />
            <h2 className="text-sm font-semibold text-claude-text">
              {locale === 'zh' ? '3D 结构对比' : '3D Structure Comparison'}
            </h2>
            <div className="flex items-center gap-1.5 ml-2">
              <code className="px-2 py-0.5 rounded bg-claude-border-light/60 dark:bg-[#2b2926] text-xs font-mono text-claude-accent">{pdbA}</code>
              <ArrowRight className="h-3 w-3 text-claude-text-muted" />
              <code className="px-2 py-0.5 rounded bg-claude-border-light/60 dark:bg-[#2b2926] text-xs font-mono text-claude-accent">{pdbB}</code>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* 3D Viewers */}
          <div className="flex-1 grid grid-cols-2 gap-1 min-h-0">
            <div className="relative bg-claude-bg dark:bg-[#0f0e0d]">
              <div className="absolute top-2 left-2 z-10">
                <Badge variant="outline" className="text-xs font-mono bg-white/80 dark:bg-[#242220]/80">{pdbA}</Badge>
              </div>
              <div ref={containerRefA} className="w-full h-full" />
            </div>
            <div className="relative bg-claude-bg dark:bg-[#0f0e0d]">
              <div className="absolute top-2 left-2 z-10">
                <Badge variant="outline" className="text-xs font-mono bg-white/80 dark:bg-[#242220]/80">{pdbB}</Badge>
              </div>
              <div ref={containerRefB} className="w-full h-full" />
            </div>
          </div>

          {/* Metrics */}
          <div className="px-5 py-3 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface/50 dark:bg-[#242220]/50">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-claude-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {locale === 'zh' ? '加载结构和计算对齐…' : 'Loading structures and calculating alignment…'}
              </div>
            )}
            {error && (
              <div className="text-xs text-red-500">{error}</div>
            )}
            {result && !loading && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {result.rmsd != null && (
                  <MetricCard label="RMSD (Å)" value={result.rmsd.toFixed(2)} color={result.rmsd < 2 ? 'text-emerald-600' : result.rmsd < 4 ? 'text-amber-600' : 'text-red-600'} />
                )}
                {result.sequenceIdentity != null && (
                  <MetricCard label={locale === 'zh' ? '序列一致性' : 'Seq Identity'} value={`${result.sequenceIdentity.toFixed(1)}%`} color="text-claude-accent" />
                )}
                {result.coverage != null && (
                  <MetricCard label={locale === 'zh' ? '覆盖率' : 'Coverage'} value={`${result.coverage.toFixed(1)}%`} color="text-claude-accent" />
                )}
                {result.alignedLength != null && (
                  <MetricCard label={locale === 'zh' ? '对齐长度' : 'Aligned Length'} value={`${result.alignedLength} ${locale === 'zh' ? '残基' : 'res'}`} color="text-claude-accent" />
                )}
                {result.rmsd == null && result.note && (
                  <div className="col-span-4 text-xs text-claude-text-muted italic">{result.note}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-0.5">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
