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
    title: '数据库配置',
    description: '首次使用需要创建数据库。点击「新建」创建新数据库，或点击「选择」使用已有数据库。首次运行必须完成此步骤。',
    icon: <Database className="h-4 w-4" />,
    onEnter: 'openDbWizard',
    onExit: 'closeDbWizard',
  },
  {
    title: '运行中心',
    description: '点击顶部「运行中心」按钮打开运行中心。支持三大模块：评估、文献检索、周报生成。',
    icon: <Rocket className="h-4 w-4" />,
    onEnter: 'openRunCenter',
  },
  {
    title: '评估模块',
    description: 'UniProt ID 模式支持单靶点 + 多靶点批量评估（含跨靶点相关性分析）。序列输入模式支持 AA / DNA（DNA 自动转录为氨基酸），BLAST 优先搜 pdbaa，无命中或 identity<95% 时回退 nr。可配置 maxPdb、BLAST 上限、maxLitCount，并可切换 skipBlast / forceBlast。完成后 LLM 生成分章节评估报告（附 PubMed 文献）。',
    icon: <FlaskConical className="h-4 w-4" />,
    onEnter: 'switchEval',
  },
  {
    title: '文献模块',
    description: 'PubMed 双通路检索（Path A 结构生物学关键词 + Path B 期刊 RSS），按方法筛选（Cryo-EM / X-ray / NMR），LLM 中文摘要聚合，可在历史报告列表中回看任意日期摘要。',
    icon: <BookOpen className="h-4 w-4" />,
    onEnter: 'switchLit',
  },
  {
    title: '周报模块',
    description: '对抗式生成 PDB 周报：Generator → Critic → Synthesis。支持 ISO 周选择（自动检测最近可用窗口），可设 1–3 cycle 迭代提升质量。',
    icon: <CalendarClock className="h-4 w-4" />,
    onEnter: 'switchWeekly',
    onExit: 'closeRunCenter',
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
 * spotlight. If it would overflow the viewport, it flips to other corners in
 * this priority order: bottom-left → top-right → top-left.
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

  // ── Try bottom-right (preferred) ──
  let left = spotlight.right + TOOLTIP_GAP;
  let top = spotlight.bottom + TOOLTIP_GAP;
  let side: TooltipPos['side'] = 'bottom-right';

  const overflowsRight = left + TOOLTIP_WIDTH > vw - VIEWPORT_MARGIN;
  const overflowsBottom = top + h > vh - VIEWPORT_MARGIN;

  if (overflowsRight && overflowsBottom) {
    // Both overflow → top-left
    left = spotlight.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
    top = spotlight.top - TOOLTIP_GAP - h;
    side = 'top-left';
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
              className="absolute pointer-events-none rounded-lg"
              style={{
                top: spotlightRect.top,
                left: spotlightRect.left,
                width: spotlightRect.width,
                height: spotlightRect.height,
                boxShadow: `0 0 0 9999px rgba(0,0,0,${MASK_OPACITY})`,
              }}
            />
            {/* Animated border frame around the spotlight */}
            <motion.div
              className="absolute rounded-lg border-2 border-claude-accent pointer-events-none"
              style={{
                top: spotlightRect.top - SPOTLIGHT_PADDING,
                left: spotlightRect.left - SPOTLIGHT_PADDING,
                width: spotlightRect.width + SPOTLIGHT_PADDING * 2,
                height: spotlightRect.height + SPOTLIGHT_PADDING * 2,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.3), 0 0 20px rgba(0,0,0,0.3)',
              }}
              animate={{
                boxShadow: [
                  '0 0 0 1px rgba(255,255,255,0.3), 0 0 20px rgba(0,0,0,0.3)',
                  '0 0 0 2px rgba(255,255,255,0.5), 0 0 24px rgba(0,0,0,0.4)',
                  '0 0 0 1px rgba(255,255,255,0.3), 0 0 20px rgba(0,0,0,0.3)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
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
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="absolute pointer-events-auto"
          style={{
            top: pos.top,
            left: pos.left,
            width: TOOLTIP_WIDTH,
          }}
        >
          <div className="relative bg-white dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-xl shadow-2xl overflow-hidden">
            {/* Header bar */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 bg-gradient-to-r from-claude-accent/10 to-transparent">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 border border-claude-accent/20 flex items-center justify-center text-claude-accent flex-shrink-0">
                {stepConfig.icon || <Sparkles className="h-3.5 w-3.5" />}
              </div>
              <span className="text-[10px] font-mono text-claude-text-muted bg-claude-border-light dark:bg-[#3d3832] px-1.5 py-0.5 rounded">
                {tourStep + 1} / {steps.length}
              </span>
              <button
                onClick={finishTour}
                className="ml-auto text-claude-text-muted hover:text-claude-text transition-colors p-0.5"
                aria-label="跳过引导"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-4 pb-3">
              <h3 className="text-sm font-semibold text-claude-text leading-tight mb-1.5">{stepConfig.title}</h3>
              <p className="text-xs text-claude-text-secondary leading-relaxed mb-3 max-h-[200px] overflow-y-auto thin-scroll">
                {stepConfig.description}
              </p>

              {/* Progress dots */}
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
              <div className="flex items-center gap-1.5">
                {tourStep > 0 && (
                  <button
                    onClick={() => setTourStep(tourStep - 1)}
                    className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-claude-text-secondary hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> 上一步
                  </button>
                )}
                <button
                  onClick={() => { if (isLastStep) finishTour(); else setTourStep(tourStep + 1); }}
                  className={`flex items-center gap-1 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ml-auto ${
                    isLastStep
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700'
                      : 'bg-gradient-to-r from-claude-accent to-claude-accent-hover text-white hover:opacity-90'
                  }`}
                >
                  {isLastStep ? <>开始使用 <CheckCircle2 className="h-3.5 w-3.5" /></> : <>下一步 <ChevronRight className="h-3.5 w-3.5" /></>}
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
