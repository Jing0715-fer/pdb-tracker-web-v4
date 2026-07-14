'use client';

import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Tour Types & Config ──────────────────────────────────────────────────────

export interface TourStepConfig {
  /** Ref to the element to spotlight. When null/missing, the tooltip is centered. */
  targetRef?: React.RefObject<HTMLElement | null>;
  title: string;
  description: string;
}

export const TOUR_STEPS: Omit<TourStepConfig, 'targetRef'>[] = [
  {
    title: '欢迎使用 PDB Structure Tracker',
    description:
      '蛋白结构数据库追踪平台。追踪 PDB 每周发布、评估蛋白靶点可成药性、监控结构生物学文献。点击「下一步」了解核心功能。',
  },
  {
    title: '模式切换',
    description:
      '在 Weekly / Evaluation / Literature 三种模式间切换。Weekly 浏览每周 PDB 发布；Evaluation 评估蛋白靶点；Literature 追踪结构生物学文献。',
  },
  {
    title: '运行中心',
    description:
      '点击顶部「运行中心」按钮打开运行中心。支持三大模块：① 蛋白靶点评估（含批量评估和互作关系分析）、② 每日文献检索、③ PDB 周报生成。支持 SSE 实时进度和 z.ai SDK LLM 测试。',
  },
  {
    title: '数据库配置',
    description:
      '运行中心内置数据库管理。首次使用请点击「新建」创建数据库，或点击「选择」使用已有数据库。运行中心与三大模块共用同一数据库。',
  },
  {
    title: '评估模块',
    description:
      '在运行中心的「① 蛋白靶点评估」tab 中，输入 UniProt ID（可添加多个靶点进行批量评估）。系统自动检测共有 PDB 结构并生成互作关系分析报告。勾选「跳过BLAST」可加速评估。',
  },
  {
    title: '文献模块',
    description:
      '「② 每日文献检索」tab 自动从 PubMed 检索结构生物学论文，按方法筛选（Cryo-EM / X-ray / NMR），生成 LLM 中文摘要。点击历史报告可查看已有摘要。',
  },
  {
    title: '周报模块',
    description:
      '「③ PDB 周报生成」tab 生成对抗式 PDB 周报（Generator → Critic → Synthesis）。可选择 ISO 周，支持 1-3 cycle 对抗式生成。',
  },
  {
    title: '搜索与快捷键',
    description:
      '按 / 聚焦搜索框，按 ? 查看所有快捷键。搜索支持 PDB ID、UniProt ID、基因名。',
  },
  {
    title: '开始使用',
    description: '设置完成后即可开始使用。如需重新查看引导，点击右上角帮助按钮。',
  },
];

// ─── Tour Card (shared between centered & spotlight modes) ─────────────────────

function TourCard({
  tourStep,
  isLastStep,
  totalSteps,
  stepConfig,
  setTourStep,
  finishTour,
  width,
}: {
  tourStep: number;
  isLastStep: boolean;
  totalSteps: number;
  stepConfig: Omit<TourStepConfig, 'targetRef'>;
  setTourStep: (s: number) => void;
  finishTour: () => void;
  width: string;
}) {
  return (
    <div
      className={`relative bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-xl shadow-2xl p-5 ${width} pointer-events-auto`}
    >
      <button
        onClick={finishTour}
        className="absolute top-3 right-3 text-[11px] text-claude-text-muted hover:text-claude-text transition-colors"
      >
        跳过
      </button>

      <div className="flex items-start gap-2.5 mb-3">
        <span className="h-6 w-6 rounded-full bg-claude-accent text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          {tourStep + 1}
        </span>
        <div className="min-w-0 pr-10">
          <div className="text-[15px] font-semibold text-claude-text leading-tight">
            {stepConfig.title}
          </div>
        </div>
      </div>

      <p className="text-[13px] text-claude-text-secondary leading-relaxed mb-4 pl-[34px]">
        {stepConfig.description}
      </p>

      <div className="flex items-center gap-1.5 pl-[34px] mb-4">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              i === tourStep
                ? 'bg-claude-accent w-4'
                : 'bg-claude-text-muted/30 w-1.5'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 pl-[34px]">
        {tourStep > 0 && (
          <button
            onClick={() => setTourStep(tourStep - 1)}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-claude-text-secondary hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-claude-border transition-colors"
          >
            上一步
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => {
            if (isLastStep) {
              finishTour();
            } else {
              setTourStep(tourStep + 1);
            }
          }}
          className="px-4 py-1.5 rounded-md text-[12px] font-medium bg-claude-accent text-white hover:bg-claude-accent-hover transition-colors"
        >
          {isLastStep ? '开始使用' : '下一步'}
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
      setTooltipPos({ top: 0, left: 0 });
      return;
    }
    const el = currentStep.targetRef.current;
    const rect = el.getBoundingClientRect();
    setSpotlightRect(rect);

    const tooltipWidth = 320;
    const tooltipHeight = 220;
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
  const isCentered = !spotlightRect;

  // ─── Centered mode (no spotlight target) ──────────────────────────────
  if (isCentered) {
    return createPortal(
      <AnimatePresence mode="wait">
        <motion.div
          key={`tour-step-${tourStep}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-black/50" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22 }}
            className="relative pointer-events-none"
          >
            <TourCard
              tourStep={tourStep}
              isLastStep={isLastStep}
              totalSteps={TOUR_STEPS.length}
              stepConfig={stepConfig}
              setTourStep={setTourStep}
              finishTour={finishTour}
              width="max-w-md w-[min(92vw,420px)]"
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>,
      document.body
    );
  }

  // ─── Spotlight mode (target element is highlighted) ───────────────────
  return createPortal(
    <AnimatePresence mode="wait">
      <motion.div
        key={`tour-step-${tourStep}`}
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
          className="absolute rounded-lg border-2 border-claude-accent animate-[pulse_2s_ease-in-out_infinite] pointer-events-none"
          style={{
            top: spotlightRect!.top - 4,
            left: spotlightRect!.left - 4,
            width: spotlightRect!.width + 8,
            height: spotlightRect!.height + 8,
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: positionAbove ? 6 : -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: positionAbove ? 6 : -6 }}
          transition={{ duration: 0.2 }}
          className="absolute pointer-events-auto"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
          }}
        >
          <TourCard
            tourStep={tourStep}
            isLastStep={isLastStep}
            totalSteps={TOUR_STEPS.length}
            stepConfig={stepConfig}
            setTourStep={setTourStep}
            finishTour={finishTour}
            width="max-w-[320px]"
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
