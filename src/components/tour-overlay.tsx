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
 *   0. 欢迎使用 PDB Structure Tracker (centered, no spotlight)
 *   1. 模式切换                          (spotlight: modeSwitcherRef)
 *   2. 数据库配置                        (open DB wizard: onEnter=openDbWizard, onExit=closeDbWizard)
 *   3. 运行中心                          (open Run Center: onEnter=openRunCenter, onExit=closeRunCenter)
 *   4. 评估模块                          (switch Run Center tab: onEnter=switchEval)
 *   5. 文献模块                          (switch Run Center tab: onEnter=switchLit)
 *   6. 周报模块                          (switch Run Center tab: onEnter=switchWeekly)
 *   7. 搜索与快捷键                      (spotlight: searchRef)
 *   8. 开始使用                          (centered, no spotlight)
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
    onExit: 'closeRunCenter',
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

// ─── Tour Overlay (compact floating card anchored to spotlight) ───────────────

const TOOLTIP_WIDTH = 320;       // px — compact card
const TOOLTIP_GAP = 14;          // px — gap between spotlight and tooltip
const VIEWPORT_MARGIN = 12;      // px — min distance from viewport edge

interface TooltipPos {
  top: number;
  left: number;
  caretSide: 'right' | 'left' | 'top' | 'bottom';
  caretTop: number;
  caretLeft: number;
}

/**
 * Compute a tooltip position that sits at the bottom-right of the spotlighted
 * element. Falls back to bottom-right of the viewport when there is no
 * spotlight (centered mode).
 *
 * The caret (small arrow) always points back toward the spotlight.
 */
function computeTooltipPos(spotlight: DOMRect | null): TooltipPos {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;

  if (!spotlight) {
    // Centered mode — page bottom-right corner, no caret.
    return {
      top: vh - 16,
      left: vw - 16,
      caretSide: 'bottom',
      caretTop: 0,
      caretLeft: 0,
    };
  }

  // Default: bottom-right of the spotlight (just past the right edge, slightly
  // below the bottom). This is the "floating card pointing to highlighted
  // element" look.
  let left = spotlight.right + TOOLTIP_GAP;
  let top = spotlight.bottom + TOOLTIP_GAP;
  let caretSide: TooltipPos['caretSide'] = 'left'; // caret on left side pointing left toward spotlight
  // caret vertical position — aligned with top of tooltip
  let caretTop = 14;
  let caretLeft = 0;

  // If placing at bottom-right would overflow the viewport, flip to bottom-left.
  if (left + TOOLTIP_WIDTH > vw - VIEWPORT_MARGIN) {
    left = spotlight.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
    caretSide = 'right';
    caretLeft = TOOLTIP_WIDTH;
    // If bottom-left also overflows (very narrow viewport), put it above the
    // spotlight centered horizontally.
    if (left < VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, Math.min(vw - VIEWPORT_MARGIN - TOOLTIP_WIDTH, spotlight.left + spotlight.width / 2 - TOOLTIP_WIDTH / 2));
      top = spotlight.top - TOOLTIP_GAP; // we'll measure actual height below; this is just a placeholder
      caretSide = 'bottom';
      caretTop = 0;
      caretLeft = Math.max(20, Math.min(TOOLTIP_WIDTH - 20, spotlight.left + spotlight.width / 2 - left));
    }
  }

  // If tooltip would overflow the bottom of the viewport, flip to top.
  // Use an estimated tooltip height of 220px (compact card).
  const ESTIMATED_HEIGHT = 220;
  if (top + ESTIMATED_HEIGHT > vh - VIEWPORT_MARGIN) {
    // Flip vertically above the spotlight.
    top = spotlight.top - TOOLTIP_GAP - ESTIMATED_HEIGHT;
    if (top < VIEWPORT_MARGIN) {
      // Final fallback: bottom-right corner.
      top = vh - 16;
      left = vw - 16;
      caretSide = 'bottom';
      caretTop = 0;
      caretLeft = 0;
    } else {
      caretSide = caretSide === 'left' ? 'left' : caretSide === 'right' ? 'right' : 'bottom';
      if (caretSide === 'left' || caretSide === 'right') {
        caretTop = ESTIMATED_HEIGHT - 14; // caret near bottom of card when card is above spotlight
      }
    }
  }

  // Clamp into viewport.
  top = Math.max(VIEWPORT_MARGIN, Math.min(vh - VIEWPORT_MARGIN - ESTIMATED_HEIGHT, top));
  left = Math.max(VIEWPORT_MARGIN, Math.min(vw - VIEWPORT_MARGIN - TOOLTIP_WIDTH, left));

  return { top, left, caretSide, caretTop, caretLeft };
}

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

  const updatePosition = useCallback(() => {
    if (!currentStep?.targetRef?.current) {
      setSpotlightRect(null);
      return;
    }
    const el = currentStep.targetRef.current;
    if (!el.isConnected) {
      setSpotlightRect(null);
      return;
    }
    setSpotlightRect(el.getBoundingClientRect());
  }, [currentStep]);

  // Measure actual tooltip height once it renders so the position calc can
  // use a real value instead of an estimate.
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

  const pos = computeTooltipPos(spotlightRect);
  // Override estimated height in the position computation using the real
  // measured height. We re-compute here so the tooltip reflows when its
  // content changes (different step descriptions have different lengths).
  const realPos = (() => {
    if (!spotlightRect) return pos;
    // Re-run the position calc with the measured tooltip height to keep the
    // caret correctly aligned when the card is taller / shorter than the
    // 220px estimate.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = tooltipHeight || 220;
    let left = spotlightRect.right + TOOLTIP_GAP;
    let top = spotlightRect.bottom + TOOLTIP_GAP;
    let caretSide: TooltipPos['caretSide'] = 'left';
    let caretTop = 14;
    let caretLeft = 0;

    if (left + TOOLTIP_WIDTH > vw - VIEWPORT_MARGIN) {
      left = spotlightRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
      caretSide = 'right';
      caretLeft = TOOLTIP_WIDTH;
      if (left < VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, Math.min(vw - VIEWPORT_MARGIN - TOOLTIP_WIDTH, spotlightRect.left + spotlightRect.width / 2 - TOOLTIP_WIDTH / 2));
        top = spotlightRect.top - TOOLTIP_GAP - h;
        caretSide = 'bottom';
        caretTop = 0;
        caretLeft = Math.max(20, Math.min(TOOLTIP_WIDTH - 20, spotlightRect.left + spotlightRect.width / 2 - left));
      }
    }
    if (top + h > vh - VIEWPORT_MARGIN) {
      const newTop = spotlightRect.top - TOOLTIP_GAP - h;
      if (newTop >= VIEWPORT_MARGIN) {
        top = newTop;
        if (caretSide === 'left' || caretSide === 'right') {
          caretTop = h - 14;
        }
      } else {
        // Final fallback: bottom-right corner.
        top = vh - 16;
        left = vw - 16;
        caretSide = 'bottom';
        caretTop = 0;
        caretLeft = 0;
      }
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(vh - VIEWPORT_MARGIN - h, top));
    left = Math.max(VIEWPORT_MARGIN, Math.min(vw - VIEWPORT_MARGIN - TOOLTIP_WIDTH, left));
    return { top, left, caretSide, caretTop, caretLeft };
  })();

  // Caret rotation/position style — small triangle pointing back to the spotlight.
  const caretStyle: React.CSSProperties = (() => {
    if (!spotlightRect) return { display: 'none' };
    const base: React.CSSProperties = {
      position: 'absolute',
      width: 10,
      height: 10,
      background: 'inherit',
      borderTop: '1px solid',
      borderLeft: '1px solid',
      borderColor: 'rgb(0 0 0 / 0.08)',
    };
    if (realPos.caretSide === 'left') {
      // Caret on left edge, pointing left (toward spotlight on the left).
      return { ...base, top: realPos.caretTop, left: -6, transform: 'rotate(-45deg)' };
    }
    if (realPos.caretSide === 'right') {
      return { ...base, top: realPos.caretTop, left: realPos.caretLeft - 4, transform: 'rotate(135deg)' };
    }
    if (realPos.caretSide === 'bottom') {
      // Caret on bottom edge, pointing down.
      return { ...base, top: (tooltipHeight || 220) - 6, left: realPos.caretLeft - 5, transform: 'rotate(45deg)' };
    }
    return { ...base, top: -6, left: realPos.caretLeft - 5, transform: 'rotate(-135deg)' };
  })();

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

        {/* Compact floating tooltip card — anchored to spotlight (or bottom-right fallback) */}
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="absolute pointer-events-auto"
          style={{
            top: realPos.top,
            left: realPos.left,
            width: TOOLTIP_WIDTH,
            // Centered mode: anchor card to bottom-right corner. Framer-motion
            // overrides any inline `transform`, so we use `right`/`bottom` plus
            // an `x: 0, y: 0` motion to keep the initial/exit offset animation
            // working. Without this fix, the tooltip rendered outside the
            // viewport (x ≈ vw + 218, y ≈ vh + 122) because the inline
            // `transform: translate(-100%, -100%)` was being clobbered.
            ...(spotlightRect
              ? {}
              : {
                  right: 16,
                  bottom: 16,
                  left: 'auto',
                  top: 'auto',
                }),
          }}
        >
          <div className="relative bg-white dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-xl shadow-2xl overflow-hidden">
            {/* Caret (only when spotlighted) */}
            {spotlightRect && <span style={caretStyle} className="bg-white dark:bg-[#242220]" />}

            {/* Header bar — compact */}
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 bg-gradient-to-r from-claude-accent/8 to-transparent">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 border border-claude-accent/20 flex items-center justify-center text-claude-accent flex-shrink-0">
                {stepConfig.icon || <Sparkles className="h-3 w-3" />}
              </div>
              <span className="text-[10px] font-mono text-claude-text-muted bg-claude-border-light dark:bg-[#3d3832] px-1.5 py-0.5 rounded">
                {tourStep + 1} / {steps.length}
              </span>
              <button
                onClick={finishTour}
                className="ml-auto text-claude-text-muted hover:text-claude-text transition-colors p-0.5"
                aria-label="跳过引导"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="px-3 pb-2.5">
              <h3 className="text-[13px] font-semibold text-claude-text leading-tight mb-1">{stepConfig.title}</h3>
              <p className="text-[11px] text-claude-text-secondary leading-relaxed mb-2.5 max-h-[180px] overflow-y-auto thin-scroll">
                {stepConfig.description}
              </p>

              {/* Progress dots */}
              <div className="flex items-center gap-1 mb-2.5">
                {Array.from({ length: steps.length }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      i === tourStep ? 'w-5 bg-claude-accent' : i < tourStep ? 'w-1.5 bg-claude-accent/40' : 'w-1.5 bg-claude-border-light dark:bg-[#3d3832]'
                    }`}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-1.5">
                {tourStep > 0 && (
                  <button
                    onClick={() => setTourStep(tourStep - 1)}
                    className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium text-claude-text-secondary hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                  >
                    <ChevronLeft className="h-3 w-3" /> 上一步
                  </button>
                )}
                <button
                  onClick={() => { if (isLastStep) finishTour(); else setTourStep(tourStep + 1); }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-all ml-auto ${
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
