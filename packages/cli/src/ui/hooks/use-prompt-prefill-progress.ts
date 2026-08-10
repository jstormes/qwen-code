/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { PromptPrefillProgress } from '@qwen-code/qwen-code-core';
import { promptPrefillProgressService } from '@qwen-code/qwen-code-core';

/** How often the extrapolated fraction is recomputed while prefilling. */
const TICK_MS = 200;

/**
 * Below this fraction remaining, showing a bar is worse than showing nothing:
 * it appears and vanishes in the same breath. A prompt served ~entirely from
 * the server's cache lands here, which is the common case after the first turn
 * in a directory.
 */
const MIN_REMAINING_FRACTION = 0.02;

export interface PrefillProgressView {
  /** 0–1, extrapolated between server events so the bar does not freeze. */
  fraction: number;
  /** Prompt tokens the server is working through. */
  total: number;
  /** Seconds left at the observed rate, or null before a rate is known. */
  etaSeconds: number | null;
}

/**
 * Observed prefill rate in tokens/sec, or null if not yet measurable.
 *
 * Computed from *uncached* tokens only. The server reports `processed`
 * starting at `cache`, so a mostly-cached prompt would otherwise appear to
 * prefill at an absurd rate for one event and then crawl — and the ETA built
 * on it would be wrong in the direction that matters, promising a finish that
 * does not arrive.
 */
function observedRate(p: PromptPrefillProgress): number | null {
  const done = p.processed - p.cache;
  if (done <= 0 || p.timeMs <= 0) return null;
  return (done / p.timeMs) * 1000;
}

/** Project a report forward to `now`, or null if there is nothing to show. */
function project(
  p: PromptPrefillProgress,
  now: number,
): PrefillProgressView | null {
  // Whether to show a bar at all is a property of what the *server* reported,
  // never of the projection. Deciding it on the projected value instead would
  // make a slower-than-estimated prefill drop the bar and restore the witty
  // phrase while the wait is still going — losing the user's only status
  // readout at exactly the point they most need it.
  if ((p.total - p.processed) / p.total < MIN_REMAINING_FRACTION) return null;

  const rate = observedRate(p);
  const elapsedSec = Math.max(0, (now - p.receivedAt) / 1000);

  // Never let extrapolation reach `total`: the last 0.5% is reserved for an
  // actual report saying so. Overshooting into a claimed 100% while the wait
  // continues is the exact impression this exists to correct, so a stalled or
  // underestimated prefill holds just short of the end instead.
  const ceiling = p.total - Math.max(1, p.total * 0.005);
  const estimated =
    rate === null
      ? p.processed
      : Math.min(ceiling, p.processed + rate * elapsedSec);

  const processed = Math.max(p.processed, Math.min(p.total, estimated));

  return {
    fraction: processed / p.total,
    total: p.total,
    etaSeconds:
      rate === null || rate <= 0 ? null : (p.total - processed) / rate,
  };
}

/**
 * Live view of prompt-prefill progress, or null when nothing is prefilling.
 *
 * The server reports once per prompt batch, which at a large batch size is
 * every several seconds — a bar driven straight off those events sits still
 * and then jumps, which reads as a hang rather than as progress. So the last
 * report is extrapolated forward at its own measured rate, and each new report
 * re-anchors it.
 *
 * The ticker only runs while a report is active, so an idle session pays
 * nothing for this hook beyond one store subscription.
 */
export function usePromptPrefillProgress(): PrefillProgressView | null {
  const [view, setView] = useState<PrefillProgressView | null>(null);

  useEffect(() => {
    let ticker: ReturnType<typeof setInterval> | null = null;

    const stopTicker = () => {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
    };

    const refresh = () => {
      const active = promptPrefillProgressService.getActive();
      if (!active) {
        stopTicker();
        setView((prev) => (prev === null ? prev : null));
        return;
      }
      const next = project(active, Date.now());
      setView((prev) =>
        prev === null && next === null
          ? prev
          : (next as PrefillProgressView | null),
      );
    };

    const onChange = () => {
      // Start ticking on the first report and keep ticking until the store
      // clears, so the bar advances between the server's coarse updates.
      if (promptPrefillProgressService.getActive() && ticker === null) {
        ticker = setInterval(refresh, TICK_MS);
      }
      refresh();
    };

    const unsubscribe = promptPrefillProgressService.subscribe(onChange);
    // Adopt any report that arrived before this component mounted.
    onChange();

    return () => {
      unsubscribe();
      stopTicker();
    };
  }, []);

  return view;
}
