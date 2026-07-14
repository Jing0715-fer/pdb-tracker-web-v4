'use client';

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { TOUR_STEPS, type TourStepConfig } from '@/components/tour-overlay';

export const TOUR_COMPLETED_KEY = 'pdb-tracker:tour-completed';

export interface TourRefs {
  modeSwitcherRef?: RefObject<HTMLElement | null>;
  searchRef?: RefObject<HTMLElement | null>;
  /** Run Center dialog content area — spotlighted by the eval/lit/weekly
      module steps so the tour's tooltip anchors to the open dialog. */
  runCenterContentRef?: RefObject<HTMLElement | null>;
}

export interface UseTourOptions {
  mounted: boolean;
  refs?: TourRefs;
  autoStartDelay?: number;
  /** Called when a step with onEnter='openDbWizard' is entered. */
  onOpenDbWizard?: () => void;
  /** Called when a step with onExit='closeDbWizard' is left. */
  onCloseDbWizard?: () => void;
  /** Called when a step with onEnter='openRunCenter' is entered. Receives
      the optional tab to switch to (e.g. 'evaluation' / 'literature' /
      'weekly') so the host can both open the Run Center dialog AND switch
      its tab in a single callback. */
  onOpenRunCenter?: (tab?: string) => void;
  /** Called when a step with onExit='closeRunCenter' is left. */
  onCloseRunCenter?: () => void;
  /** Called to switch the Run Center tab (for module steps). */
  onSwitchTab?: (tab: string) => void;
  /** Called when a step with onEnter='switchEval' is entered. */
  onSwitchEval?: () => void;
  /** Called when a step with onEnter='switchLit' is entered. */
  onSwitchLit?: () => void;
  /** Called when a step with onEnter='switchWeekly' is entered. */
  onSwitchWeekly?: () => void;
}

export interface UseTourReturn {
  tourActive: boolean;
  tourStep: number;
  setTourStep: (s: number) => void;
  finishTour: () => void;
  startTour: () => void;
  steps: TourStepConfig[];
}

function buildSteps(refs?: TourRefs): TourStepConfig[] {
  return TOUR_STEPS.map((step, i) => {
    let targetRef: TourStepConfig['targetRef'];
    // Step index 1 = 模式切换 → spotlight mode switcher
    if (i === 1) targetRef = refs?.modeSwitcherRef;
    // Step index 7 = 搜索与快捷键 → spotlight search box
    else if (i === 7) targetRef = refs?.searchRef;
    // Step indices 4 / 5 / 6 = 评估 / 文献 / 周报 module steps → spotlight
    // the Run Center dialog content area so the tooltip anchors to the
    // open dialog instead of dangling in a corner.
    else if (i === 4 || i === 5 || i === 6) targetRef = refs?.runCenterContentRef;
    return { ...step, targetRef };
  });
}

export function useTour({
  mounted,
  refs,
  autoStartDelay = 1500,
  onOpenDbWizard,
  onCloseDbWizard,
  onOpenRunCenter,
  onCloseRunCenter,
  onSwitchTab,
  onSwitchEval,
  onSwitchLit,
  onSwitchWeekly,
}: UseTourOptions): UseTourReturn {
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const autoStartedRef = useRef(false);
  const prevStepRef = useRef(-1);

  // Auto-start on first visit (desktop only)
  useEffect(() => {
    if (!mounted) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    try {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
      if (!completed) {
        const timer = setTimeout(() => {
          setTourActive(true);
          setTourStep(0);
        }, autoStartDelay);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [mounted, autoStartDelay]);

  // Handle step enter/exit actions. The new step order:
  //   0: 欢迎 (centered)
  //   1: 模式切换 (spotlight)
  //   2: 数据库配置 (open DB wizard on enter, close on exit)
  //   3: 运行中心 (open Run Center on enter; dialog stays open for steps 4-6)
  //   4: 评估模块 (open Run Center + switch to evaluation tab)
  //   5: 文献模块 (open Run Center + switch to literature tab)
  //   6: 周报模块 (open Run Center + switch to weekly tab; close on exit)
  //   7: 搜索与快捷键 (spotlight)
  //   8: 开始使用 (centered)
  useEffect(() => {
    if (!tourActive) return;
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    // ── Exit previous step actions ──
    if (prevStepRef.current >= 0 && prevStepRef.current !== tourStep) {
      const prevStep = TOUR_STEPS[prevStepRef.current];
      if (prevStep?.onExit === 'closeDbWizard' && onCloseDbWizard) {
        onCloseDbWizard();
      }
      if (prevStep?.onExit === 'closeRunCenter' && onCloseRunCenter) {
        onCloseRunCenter();
      }
    }

    // ── Enter current step actions ──
    if (step.onEnter === 'openDbWizard' && onOpenDbWizard) {
      onOpenDbWizard();
    }
    if (step.onEnter === 'openRunCenter') {
      // Step 3 (运行中心): close DB wizard first (left over from step 2), then
      // open the Run Center dialog (default to evaluation tab).
      if (onCloseDbWizard) onCloseDbWizard();
      if (onOpenRunCenter) onOpenRunCenter('evaluation');
    }
    if (step.onEnter === 'switchEval') {
      // Steps 4-6 also open the Run Center (in case the user navigated here
      // directly via 上一步/下一步 without going through step 3) AND switch
      // to the matching tab in a single callback.
      if (onOpenRunCenter) onOpenRunCenter('evaluation');
      else if (onSwitchTab) onSwitchTab('evaluation');
      if (onSwitchEval) onSwitchEval();
    }
    if (step.onEnter === 'switchLit') {
      if (onOpenRunCenter) onOpenRunCenter('literature');
      else if (onSwitchTab) onSwitchTab('literature');
      if (onSwitchLit) onSwitchLit();
    }
    if (step.onEnter === 'switchWeekly') {
      if (onOpenRunCenter) onOpenRunCenter('weekly');
      else if (onSwitchTab) onSwitchTab('weekly');
      if (onSwitchWeekly) onSwitchWeekly();
    }

    prevStepRef.current = tourStep;
  }, [
    tourActive,
    tourStep,
    onOpenDbWizard,
    onCloseDbWizard,
    onOpenRunCenter,
    onCloseRunCenter,
    onSwitchTab,
    onSwitchEval,
    onSwitchLit,
    onSwitchWeekly,
  ]);

  // Clean up on finish
  const finishTour = useCallback(() => {
    // Close any open dialogs
    if (onCloseDbWizard) onCloseDbWizard();
    if (onCloseRunCenter) onCloseRunCenter();
    setTourActive(false);
    setTourStep(0);
    prevStepRef.current = -1;
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    } catch { /* ignore */ }
    toast('引导已完成', {
      description: '随时点击右上角「帮助」按钮重新查看引导。',
    });
  }, [onCloseDbWizard, onCloseRunCenter]);

  const startTour = useCallback(() => {
    setTourActive(true);
    setTourStep(0);
    prevStepRef.current = -1;
  }, []);

  const steps = buildSteps(refs);

  return { tourActive, tourStep, setTourStep, finishTour, startTour, steps };
}
