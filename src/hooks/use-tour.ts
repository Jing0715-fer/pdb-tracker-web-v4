'use client';

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { TOUR_STEPS, type TourStepConfig } from '@/components/tour-overlay';

/** localStorage key used to mark the tour as completed (auto-start is skipped once set). */
export const TOUR_COMPLETED_KEY = 'pdb-tracker:tour-completed';

/**
 * Refs that the parent component may pass in to spotlight specific elements.
 * All refs are optional — when a ref is missing (or `.current` is null) the
 * corresponding tour step renders as a centered tooltip without a spotlight.
 */
export interface TourRefs {
  /** Step 1 (index 1) — mode switcher segmented control. */
  modeSwitcherRef?: RefObject<HTMLElement | null>;
  /** Step 7 (index 7) — search input wrapper. */
  searchRef?: RefObject<HTMLElement | null>;
}

export interface UseTourOptions {
  /** `true` once the component has mounted (client-side). */
  mounted: boolean;
  /** Optional refs to spotlight specific elements on certain steps. */
  refs?: TourRefs;
  /** Delay (ms) before auto-starting on first visit. Default 1500. */
  autoStartDelay?: number;
}

export interface UseTourReturn {
  /** Whether the tour overlay is currently visible. */
  tourActive: boolean;
  /** Current zero-based step index. */
  tourStep: number;
  /** Setter forwarded to TourOverlay for Next/Back navigation. */
  setTourStep: (s: number) => void;
  /** Dismisses the tour and records completion in localStorage. */
  finishTour: () => void;
  /** Manually start the tour from step 0. */
  startTour: () => void;
  /** Pre-built `TourStepConfig[]` ready to pass to `<TourOverlay steps={…} />`. */
  steps: TourStepConfig[];
}

/**
 * Build the steps array by binding the provided refs to the matching TOUR_STEPS
 * entries. Steps whose ref is missing (or null) render as centered tooltips.
 *
 * Step index → ref mapping (matches the TOUR_STEPS order in tour-overlay.tsx):
 *   1 → modeSwitcherRef
 *   7 → searchRef
 * All other steps have no ref (centered mode).
 */
function buildSteps(refs?: TourRefs): TourStepConfig[] {
  return TOUR_STEPS.map((step, i) => {
    let targetRef: TourStepConfig['targetRef'];
    if (i === 1) targetRef = refs?.modeSwitcherRef;
    else if (i === 7) targetRef = refs?.searchRef;
    return { ...step, targetRef };
  });
}

export function useTour({ mounted, refs, autoStartDelay = 1500 }: UseTourOptions): UseTourReturn {
  // ── State ──
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // ── Auto-start guard (stable across renders) ──
  const autoStartedRef = useRef(false);

  // ── Auto-start on first visit (desktop only) ──
  useEffect(() => {
    if (!mounted) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    // Skip auto-start on mobile — spotlight navigation is awkward on small screens.
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
    } catch {
      /* ignore localStorage errors (private mode, etc.) */
    }
  }, [mounted, autoStartDelay]);

  // ── Completion handler ──
  const finishTour = useCallback(() => {
    setTourActive(false);
    setTourStep(0);
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    } catch {
      /* ignore */
    }
    toast('引导已完成', {
      description: '随时点击右上角「帮助」按钮重新查看引导。',
    });
  }, []);

  // ── Manual start ──
  const startTour = useCallback(() => {
    setTourActive(true);
    setTourStep(0);
  }, []);

  // ── Build steps array (re-computed only when refs change, which is essentially never) ──
  const steps = buildSteps(refs);

  return {
    tourActive,
    tourStep,
    setTourStep,
    finishTour,
    startTour,
    steps,
  };
}
