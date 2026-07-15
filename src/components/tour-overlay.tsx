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

/**
 * Tour step order (9 steps, Chinese):
 *   0. 欢迎使用 PDB Structure Tracker (centered modal)
 *   1. 模式切换                          (spotlight: modeSwitcherRef)
 *   2. 数据库配置                        (spotlight: dbWizardContentRef; open DB wizard on enter, close on exit)
 *   3. 运行中心                          (spotlight: runCenterContentRef; open Run Center on enter)
 *   4. 评估模块                          (spotlight: runCenterContentRef; switch to evaluation tab)
 *   5. 文献模块                          (spotlight: runCenterContentRef; switch to literature tab)
 *   6. 周报模块                          (spotlight: runCenterContentRef; switch to weekly tab; close on exit)
 *   7. 搜索与快捷键                      (spotlight: searchRef)
 *   8. 开始使用                          (centered modal)
 */
export const TOUR_STEPS: Omit<TourStepConfig, 'targetRef'>[] = [
  {
    title: '欢迎使用 PDB Tracker',
    description: '蛋白结构追踪平台，整合 PDB 周报、靶点评估、文献监控三大功能。本引导将带你了解核心操作，约需 1 分钟。',
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    title: '模式切换',
    description: '顶部三个按钮切换工作模式：Weekly 浏览每周 PDB 发布，Evaluation 评估蛋白靶点可成药性，Literature 追踪结构生物学文献。',
    icon: <LayoutGrid className="h-4 w-4" />,
  },
  {
    title: '数据库配置',
    description: '首次使用需创建数据库。在运行中心内点击「新建」创建 SQLite 数据库，或「选择」已有数据库。所有模块共用此数据库。',
    icon: <Database className="h-4 w-4" />,
    onEnter: 'openDbWizard',
    onExit: 'closeDbWizard',
  },
  {
    title: '运行中心',
    description: '点击顶部「运行中心」按钮打开操作面板，包含评估、文献、周报三个模块，支持并行执行和 SSE 实时进度。',
    icon: <Rocket className="h-4 w-4" />,
    onEnter: 'openRunCenter',
  },
  {
    title: '评估模块',
    description: '输入 UniProt ID 或氨基酸序列，自动获取 PDB 结构、BLAST 同源、PubMed 文献，LLM 生成 8 章节可成药性评估报告。支持多靶点批量评估与跨靶点相关性分析。',
    icon: <FlaskConical className="h-4 w-4" />,
    onEnter: 'switchEval',
  },
  {
    title: '文献模块',
    description: 'PubMed 双通路检索（关键词 + 期刊 RSS），按实验方法筛选（Cryo-EM / X-ray / NMR），LLM 生成中文摘要聚合，支持历史回看。',
    icon: <BookOpen className="h-4 w-4" />,
    onEnter: 'switchLit',
  },
  {
    title: '周报模块',
    description: '对抗式生成 PDB 周报：Generator → Critic → Synthesis 三阶段迭代，支持 1–3 cycle 提升质量，自动检测最近可用 ISO 周。',
    icon: <CalendarClock className="h-4 w-4" />,
    onEnter: 'switchWeekly',
    onExit: 'closeRunCenter',
  },
  {
    title: '搜索与快捷键',
    description: '按 / 快速聚焦搜索框，按 ? 查看全部快捷键。搜索支持 PDB ID、UniProt ID、基因名、蛋白名。',
    icon: <Search className="h-4 w-4" />,
  },
  {
    title: '准备就绪',
    description: '设置完成！点击右上角帮助按钮可随时重新查看引导。现在开始探索 PDB Structure Tracker 吧。',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
];

// ─── Layout constants ────────────────────────────────────────────────────────

const TOOLTIP_WIDTH = 340;       // px — card width
const TOOLTIP_GAP = 16;          // px — gap between spotlight and tooltip
const VIEWPORT_MARGIN = 16;      // px — min distance from viewport edge
const SPOTLIGHT_PADDING = 6;     // px — padding around target inside the border frame
const MASK_OPACITY = 0.55;       // dark mask opacity

// ─── Tooltip position computation ────────────────────────────────────────────

interface TooltipPos {
  top: number;
  left: number;
  /** Which side of the spotlight the tooltip sits on. */
  side: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

/**
 * Compute tooltip position. The tooltip prefers the **bottom-right** of the
 * spotlight (just past the right edge, below the bottom edge).
 *
 * Overflow handling (in priority order):
 *   1. If the tooltip fits at bottom-right → use it.
 *   2. If only the right overflows → flip to bottom-left.
 *   3. If only the bottom overflows → place at top-right.
 *   4. If both overflow → place the tooltip INSIDE the spotlight area,
 *      anchored to its bottom-right corner (the tooltip overlays the
 *      spotlight's lower-right portion). This keeps the tooltip visible
 *      at the bottom-right without jumping to the top-left.
 *
 * For centered mode (no spotlight), the tooltip is placed at the center of
 * the viewport.
 */
function computeTooltipPos(
  spotlight: DOMRect | null,
  tooltipH: number,
): TooltipPos {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;

  // ── Centered mode ──
  if (!spotlight) {
    return {
      top: Math.max(VIEWPORT_MARGIN, (vh - tooltipH) / 2),
      left: Math.max(VIEWPORT_MARGIN, (vw - TOOLTIP_WIDTH) / 2),
      side: 'bottom-right',
    };
  }

  const h = tooltipH || 220;

  // ── Try bottom-right (preferred): just past the right edge, below bottom ──
  let left = spotlight.right + TOOLTIP_GAP;
  let top = spotlight.bottom + TOOLTIP_GAP;
  let side: TooltipPos['side'] = 'bottom-right';

  const overflowsRight = left + TOOLTIP_WIDTH > vw - VIEWPORT_MARGIN;
  const overflowsBottom = top + h > vh - VIEWPORT_MARGIN;

  if (overflowsRight && overflowsBottom) {
    // Both overflow → place inside the spotlight at its bottom-right corner.
    // The tooltip overlays the lower-right portion of the spotlight, keeping
    // it at the bottom-right without jumping to top-left.
    left = Math.max(VIEWPORT_MARGIN, spotlight.right - TOOLTIP_WIDTH - 8);
    top = Math.max(VIEWPORT_MARGIN, spotlight.bottom - h - 8);
    side = 'bottom-right';
  } else if (overflowsRight) {
    // Right overflow → bottom-left
    left = spotlight.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
    top = spotlight.bottom + TOOLTIP_GAP;
    side = 'bottom-left';
  } else if (overflowsBottom) {
    // Bottom overflow → top-right
    left = spotlight.right + TOOLTIP_GAP;
    top = spotlight.top - TOOLTIP_GAP - h;
    side = 'top-right';
  }

  // Clamp into viewport.
  top = Math.max(VIEWPORT_MARGIN, Math.min(vh - VIEWPORT_MARGIN - h, top));
  left = Math.max(VIEWPORT_MARGIN, Math.min(vw - VIEWPORT_MARGIN - TOOLTIP_WIDTH, left));

  return { top, left, side };
}

// ─── Tour Overlay Component ──────────────────────────────────────────────────

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
  const [tooltipHeight, setTooltipHeight] = useState(220);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const currentStep = steps[tourStep];
  const isLastStep = tourStep === steps.length - 1;
  const stepConfig = TOUR_STEPS[tourStep];
  const isFirstStep = tourStep === 0;
  const isCentered = isFirstStep || isLastStep;

  const updatePosition = useCallback(() => {
    // Centered steps (first & last) never have a spotlight.
    if (isCentered || !currentStep?.targetRef?.current) {
      setSpotlightRect(null);
      return;
    }
    const el = currentStep.targetRef.current;
    if (!el.isConnected) {
      setSpotlightRect(null);
      return;
    }
    setSpotlightRect(el.getBoundingClientRect());
  }, [currentStep, isCentered]);

  // Measure actual tooltip height once it renders.
  useLayoutEffect(() => {
    if (!tourActive) return;
    const raf = requestAnimationFrame(() => {
      if (tooltipRef.current) {
        const h = tooltipRef.current.getBoundingClientRect().height;
        if (h > 0) setTooltipHeight(h);
      }
      updatePosition();
    });
    return () => cancelAnimationFrame(raf);
  }, [tourActive, tourStep, updatePosition]);

  // Track resize/scroll to keep the spotlight aligned.
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

  // Retry spotlight measurement when the target might still be mounting
  // (e.g. inside a dialog that's animating open).
  useEffect(() => {
    if (!tourActive || isCentered) return;
    let cancelled = false;
    let attempts = 0;
    const tryUpdate = () => {
      if (cancelled) return;
      attempts++;
      const el = currentStep?.targetRef?.current;
      if (el && el.isConnected) {
        updatePosition();
        return;
      }
      if (attempts < 20) {
        setTimeout(tryUpdate, 50);
      } else {
        updatePosition();
      }
    };
    const raf = requestAnimationFrame(tryUpdate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [tourActive, tourStep, updatePosition, currentStep, isCentered]);

  // Keyboard navigation: Esc → skip tour, ← → prev, → / Enter → next
  useEffect(() => {
    if (!tourActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishTour();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLastStep) finishTour();
        else setTourStep(tourStep + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (tourStep > 0) setTourStep(tourStep - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [tourActive, tourStep, isLastStep, setTourStep, finishTour]);

  if (!tourActive || !currentStep || !stepConfig) return null;

  const pos = computeTooltipPos(spotlightRect, tooltipHeight);
  const hasSpotlight = !isCentered && !!spotlightRect;

  return createPortal(
    <AnimatePresence mode="wait">
      <motion.div
        key={`tour-${tourStep}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[200]"
      >
        {/* ── Mask layer ─────────────────────────────────────────────── */}
        {isCentered ? (
          /* Centered mode: full-screen semi-transparent backdrop */
          <div className="absolute inset-0 bg-black/55" />
        ) : hasSpotlight && spotlightRect ? (
          /* Spotlight mode: a div sized to the target with a huge box-shadow
             creates a dark mask everywhere EXCEPT the spotlight area. */
          <>
            <div
              className="absolute pointer-events-none rounded-[8px]"
              style={{
                top: spotlightRect.top,
                left: spotlightRect.left,
                width: spotlightRect.width,
                height: spotlightRect.height,
                boxShadow: `0 0 0 9999px rgba(0,0,0,${MASK_OPACITY})`,
              }}
            />
            {/* Clean border frame around the spotlight — subtle, no animation */}
            <div
              className="absolute rounded-[10px] ring-2 ring-claude-accent pointer-events-none"
              style={{
                top: spotlightRect.top - SPOTLIGHT_PADDING,
                left: spotlightRect.left - SPOTLIGHT_PADDING,
                width: spotlightRect.width + SPOTLIGHT_PADDING * 2,
                height: spotlightRect.height + SPOTLIGHT_PADDING * 2,
              }}
            />
          </>
        ) : (
          /* Spotlight step but target not yet found — show backdrop while
             we wait for the element to mount. */
          <div className="absolute inset-0 bg-black/55" />
        )}

        {/* ── Tooltip card ───────────────────────────────────────────── */}
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="absolute pointer-events-auto"
          style={{
            top: pos.top,
            left: pos.left,
            width: TOOLTIP_WIDTH,
          }}
        >
          <div className="relative bg-white dark:bg-[#1c1b1a] rounded-xl shadow-[0_8px_32px_-4px_rgba(0,0,0,0.3),0_4px_12px_-2px_rgba(0,0,0,0.2)] ring-1 ring-black/[0.08] dark:ring-white/[0.06] overflow-hidden">
            {/* Header — step badge + close (no top accent bar) */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
              {/* Step indicator badge */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-claude-accent/10 text-claude-accent text-[10px] font-bold tabular-nums">
                    {tourStep + 1}
                  </span>
                  <span className="text-[10px] text-claude-text-muted/50 tabular-nums">/ {steps.length}</span>
                </div>
              </div>
              <button
                onClick={finishTour}
                className="h-6 w-6 rounded-md flex items-center justify-center text-claude-text-muted/50 hover:text-claude-text hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
                aria-label="跳过引导"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Content body */}
            <div className="px-4 pb-1">
              {/* Icon + Title row */}
              <div className="flex items-start gap-2.5 mb-2">
                {stepConfig.icon && (
                  <div className="h-7 w-7 rounded-lg bg-claude-accent/8 flex items-center justify-center text-claude-accent flex-shrink-0 mt-0.5">
                    {stepConfig.icon}
                  </div>
                )}
                <h3 className="text-[14px] font-semibold text-claude-text leading-tight pt-0.5">{stepConfig.title}</h3>
              </div>
              <p className="text-[12px] text-claude-text-secondary leading-[1.6] mb-3 max-h-[200px] overflow-y-auto thin-scroll">
                {stepConfig.description}
              </p>
            </div>

            {/* Footer — progress dots + buttons */}
            <div className="px-4 pb-3.5 pt-1">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mb-3">
                {Array.from({ length: steps.length }).map((_, i) => (
                  <span
                    key={i}
                    className={`rounded-full transition-all duration-300 ${
                      i === tourStep
                        ? 'w-4 h-1.5 bg-claude-accent'
                        : i < tourStep
                        ? 'w-1.5 h-1.5 bg-claude-accent/40'
                        : 'w-1.5 h-1.5 bg-black/[0.08] dark:bg-white/[0.1]'
                    }`}
                  />
                ))}
              </div>

              {/* Buttons row */}
              <div className="flex items-center gap-2">
                {tourStep > 0 && (
                  <button
                    onClick={() => setTourStep(tourStep - 1)}
                    className="flex items-center gap-0.5 px-2.5 h-7 rounded-md text-[11px] font-medium text-claude-text-secondary hover:text-claude-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> 上一步
                  </button>
                )}
                {/* Skip tour text button */}
                <button
                  onClick={finishTour}
                  className="text-[10px] text-claude-text-muted/60 hover:text-claude-text-muted transition-colors hidden sm:block"
                >
                  跳过
                </button>
                <button
                  onClick={() => { if (isLastStep) finishTour(); else setTourStep(tourStep + 1); }}
                  className={`flex items-center gap-1 px-3.5 h-7 rounded-md text-[11px] font-semibold transition-all ml-auto ${
                    isLastStep
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-claude-accent text-white hover:bg-claude-accent-hover'
                  }`}
                >
                  {isLastStep ? <>完成 <CheckCircle2 className="h-3 w-3" /></> : <>下一步 <ChevronRight className="h-3 w-3" /></>}
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
