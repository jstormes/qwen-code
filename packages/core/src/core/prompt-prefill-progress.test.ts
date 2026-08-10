/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parsePromptPrefillProgress,
  promptPrefillProgressService,
} from './prompt-prefill-progress.js';

/** A chunk shaped like the ones llama.cpp emits with `return_progress: true`. */
const chunk = (progress: unknown) => ({
  id: 'chatcmpl-x',
  object: 'chat.completion.chunk',
  model: 'Qwen3.6-35B-A3B',
  choices: [{ index: 0, delta: { role: 'assistant', content: null } }],
  prompt_progress: progress,
});

describe('parsePromptPrefillProgress', () => {
  it('parses a real llama.cpp progress chunk', () => {
    const result = parsePromptPrefillProgress(
      chunk({ total: 5213, cache: 0, processed: 4185, time_ms: 7257 }),
      1000,
    );

    expect(result).toEqual({
      total: 5213,
      cache: 0,
      processed: 4185,
      timeMs: 7257,
      receivedAt: 1000,
    });
  });

  it('returns null for chunks without the field', () => {
    expect(parsePromptPrefillProgress({ choices: [] })).toBeNull();
    expect(parsePromptPrefillProgress({ prompt_progress: null })).toBeNull();
    expect(parsePromptPrefillProgress(null)).toBeNull();
    expect(parsePromptPrefillProgress('not an object')).toBeNull();
    expect(parsePromptPrefillProgress(undefined)).toBeNull();
  });

  it.each([
    ['missing total', { cache: 0, processed: 10, time_ms: 5 }],
    ['zero total', { total: 0, cache: 0, processed: 0, time_ms: 5 }],
    ['negative total', { total: -1, cache: 0, processed: 0, time_ms: 5 }],
    ['non-numeric total', { total: '100', processed: 10 }],
    ['NaN total', { total: Number.NaN, processed: 10 }],
    ['missing processed', { total: 100 }],
    ['negative processed', { total: 100, processed: -5 }],
  ])('drops a malformed report: %s', (_label, progress) => {
    expect(parsePromptPrefillProgress(chunk(progress))).toBeNull();
  });

  it('defaults absent optional fields rather than dropping the report', () => {
    // A server that reports position but not timing is still worth a bar; it
    // just cannot support an ETA.
    const result = parsePromptPrefillProgress(
      chunk({ total: 100, processed: 40 }),
      7,
    );

    expect(result).toMatchObject({ cache: 0, timeMs: 0, processed: 40 });
  });

  it('clamps values that exceed the reported total', () => {
    // Defensive: an inconsistent report must not produce a >100% bar.
    const result = parsePromptPrefillProgress(
      chunk({ total: 100, cache: 500, processed: 300, time_ms: 1 }),
    );

    expect(result).toMatchObject({ total: 100, cache: 100, processed: 100 });
  });

  it('stamps receipt time from the clock by default', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
      const result = parsePromptPrefillProgress(
        chunk({ total: 10, processed: 1, time_ms: 1 }),
      );
      expect(result?.receivedAt).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('promptPrefillProgressService', () => {
  const report = (processed: number) => ({
    total: 100,
    cache: 0,
    processed,
    timeMs: 10,
    receivedAt: 0,
  });

  it('exposes the latest report and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = promptPrefillProgressService.subscribe(listener);

    promptPrefillProgressService.report(report(40));
    expect(promptPrefillProgressService.getActive()?.processed).toBe(40);
    expect(listener).toHaveBeenCalledTimes(1);

    promptPrefillProgressService.report(report(80));
    expect(promptPrefillProgressService.getActive()?.processed).toBe(80);
    expect(listener).toHaveBeenCalledTimes(2);

    promptPrefillProgressService.finish();
    expect(promptPrefillProgressService.getActive()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
  });

  it('makes finish() a no-op when nothing is active', () => {
    // The pipeline calls this in a `finally` for every stream, including the
    // vast majority that never report progress at all.
    const listener = vi.fn();
    const unsubscribe = promptPrefillProgressService.subscribe(listener);

    promptPrefillProgressService.finish();
    promptPrefillProgressService.finish();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    promptPrefillProgressService.subscribe(listener)();

    promptPrefillProgressService.report(report(10));
    promptPrefillProgressService.finish();

    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a listener that unsubscribes itself mid-notify', () => {
    // Guards the copy-before-iterate in notify(): without it, removing a
    // listener during dispatch skips whichever one follows it.
    const later = vi.fn();
    let unsubscribeSelf = () => {};
    unsubscribeSelf = promptPrefillProgressService.subscribe(() => {
      unsubscribeSelf();
    });
    const unsubscribeLater = promptPrefillProgressService.subscribe(later);

    promptPrefillProgressService.report(report(10));

    expect(later).toHaveBeenCalledTimes(1);
    promptPrefillProgressService.finish();
    unsubscribeLater();
  });
});
