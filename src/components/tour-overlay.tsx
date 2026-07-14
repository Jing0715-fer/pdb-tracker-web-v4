'use client';

import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles, LayoutGrid, Rocket, Database, FlaskConical,
  BookOpen, CalendarClock, Search, CheckCircle2,
  ChevronRight, ChevronLeft, X,
} from 'lucide-react';

// ─── Tour Types & Config ──────────────────────────────────────────────────────

export interface TourStepConfig {
  targetRef?: React.RefObject<HTMLElement | null>;
  title: string;
  description: string;
  icon?: React.ReactNode;
  onEnter?: string;
  onExit?: string;
}

export const TOUR_STEPS: Omit<TourStepConfig, 'targetRef'>[] = [
  {
    title: '欢迎使用 PDB Structure Tracker',
    description: '蛋白结构数据库追踪平台。追踪 PDB 每周发布、评估蛋白靶点可成药性、监控结构生物学文献。点击「下一步」了解核心功能。',
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    title: '模式切换',
    description: '在 Weekly / Evaluation / Literature 三种模式间切换。Weekly 浏览每周 PDB 发布；Evaluation 评估蛋白靶点；Literature 追踪结构生物学文献。',
    icon: <LayoutGrid className="h-4 w-4" />,
  },
  {
    title: '运行中心',
    description: '点击顶部「运行中心」按钮打开运行中心。支持三大模块：① 蛋白靶点评估（含批量评估和互作关系分析）、② 每日文献检索、③ PDB 周报生成。支持 SSE 实时进度和 z.ai SDK LLM 测试。',
    icon: <Rocket className="h-4 w-4" />,
    onEnter: 'openRunCenter',
    onExit: 'closeRunCenter',
  },
  {
    title: '数据库配置',
    description: '运行中心内置数据库管理。首次使用请点击「新建」创建数据库，或点击「选择」使用已有数据库。运行中心与三大模块共用同一数据库。首次运行时必须完成数据库配置才能继续使用。',
    icon: <Database className="h-4 w-4" />,
  },
  {
    title: '评估模块',
    description: '在运行中心的「① 蛋白靶点评估」tab 中，输入 UniProt ID 或直接输入氨基酸/DNA 序列进行评估。支持批量评估和互作关系分析。勾选「跳过BLAST」可加速评估。',
    icon: <FlaskConical className="h-4 w-4" />,
  },
  {
    title: '文献模块',
    description: '「② 每日文献检索」tab 自动从 PubMed 检索结构生物学论文，按方法筛选（Cryo-EM / X-ray / NMR），生成 LLM 中文摘要。点击历史报告可查看已有摘要。',
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    title: '周报模块',
    description: '「③ PDB 周报生成」tab 生成对抗式 PDB 周报（Generator → Critic → Synthesis）。可选择 ISO 周，支持 1-3 cycle 对抗式生成。',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  {
    title: '搜索与快捷键',
    description: '按 / 聚焦搜索框，按 ? 查看所有快捷键。搜索支持 PDB ID、UniProt ID、基因名。',
    icon: <Search className="h-4 w-4" />,
  },
  {
    title: '开始使用',
    description: '设置完成后即可开始使用。如需重新查看引导，点击右上角帮助按钮。',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
];

// ─── Tour Overlay (floating tooltip, non-blocking) ───────────────────────────

export function TourOverlay({
  tourActive,
  tourStep,
  setTourStep,
  finishTour,
  steps,
}: {
  tourActive: boolean;
  tourStep: number;
  setTourStep: (s: number) => void;
  finishTour: () => void;
  steps: TourStepConfig[];
}) {
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);

  const currentStep = steps[tourStep];
  const isLastStep = tourStep === steps.length - 1;
  const stepConfig = TOUR_STEPS[tourStep];

  const updatePosition = useCallback(() => {
    if (!currentStep?.targetRef?.current) {
      setSpotlightRect(null);
      return;
    }
    const el = currentStep.targetRef.current;
    setSpotlightRect(el.getBoundingClientRect());
  }, [currentStep]);

  useLayoutEffect(() => {
    if (!tourActive) return;
    const raf = requestAnimationFrame(() => updatePosition());
    const handleResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [tourActive, updatePosition]);

  useEffect(() => {
    if (tourActive) {
      const raf = requestAnimationFrame(() => updatePosition());
      return () => cancelAnimationFrame(raf);
    }
  }, [tourActive, tourStep, updatePosition]);

  if (!tourActive || !currentStep || !stepConfig) return null;

  return createPortal(
    <AnimatePresence mode="wait">
      <motion.div
        key={`tour-${tourStep}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[200] pointer-events-none"
      >
        {/* Spotlight (only when target exists) */}
        {spotlightRect && (
          <>
            <div
              className="absolute inset-0"
              style={{ boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)` }}
            />
            <div
              className="absolute rounded-lg border-2 border-claude-accent animate-[pulse_2s_ease-in-out_infinite] pointer-events-none"
              style={{
                top: spotlightRect.top - 4,
                left: spotlightRect.left - 4,
                width: spotlightRect.width + 8,
                height: spotlightRect.height + 8,
              }}
            />
          </>
        )}

        {/* Floating tooltip card — bottom-right corner, non-blocking */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="absolute pointer-events-auto"
          style={{
            bottom: '24px',
            right: '24px',
            maxWidth: '380px',
          }}
        >
          <div className="bg-white dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-2xl shadow-2xl overflow-hidden">
            {/* Header bar with gradient */}
            <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2 bg-gradient-to-r from-claude-accent/8 to-transparent">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 border border-claude-accent/20 flex items-center justify-center text-claude-accent flex-shrink-0">
                {stepConfig.icon || <Sparkles className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-mono text-claude-text-muted bg-claude-border-light dark:bg-[#3d3832] px-1.5 py-0.5 rounded">
                  {tourStep + 1} / {steps.length}
                </span>
              </div>
              <button
                onClick={finishTour}
                className="text-claude-text-muted hover:text-claude-text transition-colors p-0.5"
                aria-label="跳过引导"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="px-4 pb-3">
              <h3 className="text-sm font-semibold text-claude-text leading-tight mb-1.5">{stepConfig.title}</h3>
              <p className="text-xs text-claude-text-secondary leading-relaxed mb-3">
                {stepConfig.description}
              </p>

              {/* Progress bar */}
              <div className="flex items-center gap-1 mb-3">
                {Array.from({ length: steps.length }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      i === tourStep ? 'w-6 bg-claude-accent' : i < tourStep ? 'w-1.5 bg-claude-accent/40' : 'w-1.5 bg-claude-border-light dark:bg-[#3d3832]'
                    }`}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2">
                {tourStep > 0 && (
                  <button
                    onClick={() => setTourStep(tourStep - 1)}
                    className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-claude-text-secondary hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                  >
                    <ChevronLeft className="h-3 w-3" /> 上一步
                  </button>
                )}
                <button
                  onClick={() => { if (isLastStep) finishTour(); else setTourStep(tourStep + 1); }}
                  className={`flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ml-auto ${
                    isLastStep
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700'
                      : 'bg-gradient-to-r from-claude-accent to-claude-accent-hover text-white hover:opacity-90'
                  }`}
                >
                  {isLastStep ? <>开始使用 <CheckCircle2 className="h-3 w-3" /></> : <>下一步 <ChevronRight className="h-3 w-3" /></>}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
