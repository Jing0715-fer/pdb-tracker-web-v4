'use client';

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { TOUR_STEPS, type TourStepConfig } from '@/components/tour-overlay';

export const TOUR_COMPLETED_KEY = 'pdb-tracker:tour-completed';

export interface TourRefs {
  modeSwitcherRef?: RefObject<HTMLElement | null>;
  searchRef?: RefObject<HTMLElement | null>;
}

export interface UseTourOptions {
  mounted: boolean;
  refs?: TourRefs;
  autoStartDelay?: number;
  /** Called when a step with onEnter='openRunCenter' is entered. */
  onOpenRunCenter?: () => void;
  /** Called when a step with onExit='closeRunCenter' is left. */
  onCloseRunCenter?: () => void;
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
    if (i === 1) targetRef = refs?.modeSwitcherRef;
    else if (i === 7) targetRef = refs?.searchRef;
    return { ...step, targetRef };
  });
}

export function useTour({ mounted, refs, autoStartDelay = 1500, onOpenRunCenter, onCloseRunCenter }: UseTourOptions): UseTourReturn {
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

  // Handle step enter/exit actions
  useEffect(() => {
    if (!tourActive) return;
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    // Exit previous step
    if (prevStepRef.current >= 0 && prevStepRef.current !== tourStep) {
      const prevStep = TOUR_STEPS[prevStepRef.current];
      if (prevStep?.onExit === 'closeRunCenter' && onCloseRunCenter) {
        onCloseRunCenter();
      }
    }

    // Enter current step
    if (step.onEnter === 'openRunCenter' && onOpenRunCenter) {
      onOpenRunCenter();
    }

    prevStepRef.current = tourStep;
  }, [tourActive, tourStep, onOpenRunCenter, onCloseRunCenter]);

  // Clean up on finish
  const finishTour = useCallback(() => {
    // Close any open dialogs
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
  }, [onCloseRunCenter]);

  const startTour = useCallback(() => {
    setTourActive(true);
    setTourStep(0);
    prevStepRef.current = -1;
  }, []);

  const steps = buildSteps(refs);

  return { tourActive, tourStep, setTourStep, finishTour, startTour, steps };
}
