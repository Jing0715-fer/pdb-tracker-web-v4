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
  /** Action to run when entering this step (e.g., open a dialog). */
  onEnter?: () => void;
  /** Action to run when leaving this step (e.g., close a dialog). */
  onExit?: () => void;
}

export const TOUR_STEPS: Omit<TourStepConfig, 'targetRef'>[] = [
  {
    title: '欢迎使用 PDB Structure Tracker',
    description: '蛋白结构数据库追踪平台。追踪 PDB 每周发布、评估蛋白靶点可成药性、监控结构生物学文献。点击「下一步」了解核心功能。',
    icon: <Sparkles className="h-5 w-5" />,
  },
  {
    title: '模式切换',
    description: '在 Weekly / Evaluation / Literature 三种模式间切换。Weekly 浏览每周 PDB 发布；Evaluation 评估蛋白靶点；Literature 追踪结构生物学文献。',
    icon: <LayoutGrid className="h-5 w-5" />,
  },
  {
    title: '运行中心',
    description: '点击顶部「运行中心」按钮打开运行中心。支持三大模块：① 蛋白靶点评估（含批量评估和互作关系分析）、② 每日文献检索、③ PDB 周报生成。支持 SSE 实时进度和 z.ai SDK LLM 测试。',
    icon: <Rocket className="h-5 w-5" />,
    onEnter: 'openRunCenter',
    onExit: 'closeRunCenter',
  },
  {
    title: '数据库配置',
    description: '运行中心内置数据库管理。首次使用请点击「新建」创建数据库，或点击「选择」使用已有数据库。运行中心与三大模块共用同一数据库。首次运行时必须完成数据库配置才能继续使用。',
    icon: <Database className="h-5 w-5" />,
  },
  {
    title: '评估模块',
    description: '在运行中心的「① 蛋白靶点评估」tab 中，输入 UniProt ID（可添加多个靶点进行批量评估）。系统自动检测共有 PDB 结构并生成互作关系分析报告。勾选「跳过BLAST」可加速评估。',
    icon: <FlaskConical className="h-5 w-5" />,
  },
  {
    title: '文献模块',
    description: '「② 每日文献检索」tab 自动从 PubMed 检索结构生物学论文，按方法筛选（Cryo-EM / X-ray / NMR），生成 LLM 中文摘要。点击历史报告可查看已有摘要。',
    icon: <BookOpen className="h-5 w-5" />,
  },
  {
    title: '周报模块',
    description: '「③ PDB 周报生成」tab 生成对抗式 PDB 周报（Generator → Critic → Synthesis）。可选择 ISO 周，支持 1-3 cycle 对抗式生成。',
    icon: <CalendarClock className="h-5 w-5" />,
  },
  {
    title: '搜索与快捷键',
    description: '按 / 聚焦搜索框，按 ? 查看所有快捷键。搜索支持 PDB ID、UniProt ID、基因名。',
    icon: <Search className="h-5 w-5" />,
  },
  {
    title: '开始使用',
    description: '设置完成后即可开始使用。如需重新查看引导，点击右上角帮助按钮。',
    icon: <CheckCircle2 className="h-5 w-5" />,
  },
];

// ─── Tour Card (shared by both modes) ────────────────────────────────────────

function TourCard({
  stepIndex,
  total,
  title,
  description,
  icon,
  onPrev,
  onNext,
  onSkip,
  isLast,
}: {
  stepIndex: number;
  total: number;
  title: string;
  description: string;
  icon?: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}) {
  return (
    <div className="bg-white dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-2xl shadow-2xl p-5 w-[340px] max-w-[calc(100vw-32px)]">
      {/* Header with gradient accent */}
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 border border-claude-accent/20 flex items-center justify-center text-claude-accent flex-shrink-0">
          {icon || <Sparkles className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-claude-text-muted bg-claude-border-light dark:bg-[#3d3832] px-1.5 py-0.5 rounded">
              {stepIndex + 1} / {total}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-claude-text leading-tight mt-1">{title}</h3>
        </div>
        <button
          onClick={onSkip}
          className="text-claude-text-muted hover:text-claude-text transition-colors p-1 -m-1"
          aria-label="跳过引导"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-claude-text-secondary leading-relaxed mb-4 pl-[52px]">
        {description}
      </p>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 pl-[52px] mb-4">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === stepIndex
                ? 'w-6 bg-claude-accent'
                : i < stepIndex
                ? 'w-1.5 bg-claude-accent/40'
                : 'w-1.5 bg-claude-border-light dark:bg-[#3d3832]'
            }`}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pl-[52px]">
        {stepIndex > 0 && (
          <button
            onClick={onPrev}
            className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-claude-text-secondary hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
          >
            <ChevronLeft className="h-3 w-3" /> 上一步
          </button>
        )}
        <button
          onClick={onNext}
          className={`flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ml-auto ${
            isLast
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-sm'
              : 'bg-gradient-to-r from-claude-accent to-claude-accent-hover text-white hover:opacity-90 shadow-sm'
          }`}
        >
          {isLast ? (
            <>开始使用 <CheckCircle2 className="h-3 w-3" /></>
          ) : (
            <>下一步 <ChevronRight className="h-3 w-3" /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Tour Overlay ──────────────────────────────────────────────────────────────

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
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [positionAbove, setPositionAbove] = useState(false);
  const rafRef = useRef<number | null>(null);

  const currentStep = steps[tourStep];
  const isLastStep = tourStep === steps.length - 1;

  const updatePosition = useCallback(() => {
    if (!currentStep?.targetRef?.current) {
      setSpotlightRect(null);
      return;
    }
    const el = currentStep.targetRef.current;
    const rect = el.getBoundingClientRect();
    setSpotlightRect(rect);

    const tooltipWidth = 340;
    const tooltipHeight = 250;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const above = spaceBelow < tooltipHeight + gap && spaceAbove > spaceBelow;
    setPositionAbove(above);

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(8, Math.min(left, vw - tooltipWidth - 8));

    let top: number;
    if (above) {
      top = rect.top - gap - tooltipHeight;
    } else {
      top = rect.bottom + gap;
    }
    top = Math.max(8, top);

    setTooltipPos({ top, left });
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tourActive, updatePosition]);

  useEffect(() => {
    if (tourActive) {
      const raf = requestAnimationFrame(() => updatePosition());
      return () => cancelAnimationFrame(raf);
    }
  }, [tourActive, tourStep, updatePosition]);

  if (!tourActive || !currentStep) return null;

  const stepConfig = TOUR_STEPS[tourStep];

  // Centered mode (no spotlight target)
  if (!spotlightRect) {
    return createPortal(
      <AnimatePresence mode="wait">
        <motion.div
          key={`tour-centered-${tourStep}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <TourCard
              stepIndex={tourStep}
              total={steps.length}
              title={stepConfig.title}
              description={stepConfig.description}
              icon={stepConfig.icon}
              onPrev={() => setTourStep(tourStep - 1)}
              onNext={() => {
                if (isLastStep) finishTour();
                else setTourStep(tourStep + 1);
              }}
              onSkip={finishTour}
              isLast={isLastStep}
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>,
      document.body
    );
  }

  // Spotlight mode
  return createPortal(
    <AnimatePresence mode="wait">
      <motion.div
        key={`tour-spotlight-${tourStep}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] pointer-events-none"
      >
        <div
          className="absolute inset-0"
          style={{
            boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.5)`,
          }}
        />
        <div
          className="absolute rounded-xl border-2 border-claude-accent animate-[pulse_2s_ease-in-out_infinite] pointer-events-none"
          style={{
            top: spotlightRect.top - 4,
            left: spotlightRect.left - 4,
            width: spotlightRect.width + 8,
            height: spotlightRect.height + 8,
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: positionAbove ? 8 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: positionAbove ? 8 : -8 }}
          transition={{ duration: 0.2 }}
          className="absolute pointer-events-auto"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <TourCard
            stepIndex={tourStep}
            total={steps.length}
            title={stepConfig.title}
            description={stepConfig.description}
            icon={stepConfig.icon}
            onPrev={() => setTourStep(tourStep - 1)}
            onNext={() => {
              if (isLastStep) finishTour();
              else setTourStep(tourStep + 1);
            }}
            onSkip={finishTour}
            isLast={isLastStep}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
