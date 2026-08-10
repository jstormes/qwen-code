/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A prompt-prefill progress report, as emitted by an OpenAI-compatible server
 * that streams progress events while it processes the prompt.
 *
 * llama.cpp is the reference implementation: with `return_progress: true` on a
 * streaming request it emits `chat.completion.chunk`s carrying a top-level
 * `prompt_progress` object alongside an empty delta. Other servers may adopt
 * the same shape; nothing here is llama.cpp-specific beyond the field name.
 *
 * Why this matters enough to have its own channel: against a local server a
 * large startup prompt can take *minutes* to prefill before the first
 * generated token, and the whole time the UI has nothing to show but a
 * spinner. The progress events are the only signal that anything is happening,
 * and they are discarded by the normal content path because their delta is
 * empty.
 */
export interface PromptPrefillProgress {
  /** Total prompt tokens the server must account for. */
  total: number;
  /** How many of them it served from its own cache — free, already done. */
  cache: number;
  /** How many are accounted for so far. Starts at `cache`, ends at `total`. */
  processed: number;
  /** Server-side milliseconds spent so far on this prompt. */
  timeMs: number;
  /** Client clock at receipt, for extrapolating between events. */
  receivedAt: number;
}

/** Shape of the wire field, before validation. */
interface PromptProgressWire {
  total?: unknown;
  cache?: unknown;
  processed?: unknown;
  time_ms?: unknown;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Extract a progress report from a raw streaming chunk, or null if the chunk
 * does not carry one.
 *
 * Deliberately total: every field is validated, because this reads an off-spec
 * extension field that any upstream proxy is free to mangle. A malformed
 * report must be dropped, never rendered and never thrown — the request it
 * rode in on is a real user turn, and a progress bar is not worth failing one.
 */
export function parsePromptPrefillProgress(
  chunk: unknown,
  now: number = Date.now(),
): PromptPrefillProgress | null {
  if (typeof chunk !== 'object' || chunk === null) return null;
  const raw = (chunk as { prompt_progress?: unknown }).prompt_progress;
  if (typeof raw !== 'object' || raw === null) return null;

  const {
    total,
    cache,
    processed,
    time_ms: timeMs,
  } = raw as PromptProgressWire;
  if (!isFiniteNumber(total) || total <= 0) return null;
  if (!isFiniteNumber(processed) || processed < 0) return null;

  return {
    total,
    cache: isFiniteNumber(cache) && cache >= 0 ? Math.min(cache, total) : 0,
    processed: Math.min(processed, total),
    timeMs: isFiniteNumber(timeMs) && timeMs >= 0 ? timeMs : 0,
    receivedAt: now,
  };
}

/** Notified whenever the active report is replaced or cleared. */
export type PromptPrefillProgressListener = () => void;

/**
 * Process-wide store carrying prefill progress from the content generator to
 * whatever is drawing the spinner.
 *
 * A side channel rather than a stream event on purpose. Progress is display
 * state, not conversation state: it must never reach history, never be
 * replayed on resume, and never gate the content pipeline. Routing it through
 * `ServerGeminiStreamEvent` would put a per-batch, best-effort,
 * provider-specific signal into the type every consumer of a turn has to
 * handle.
 *
 * A plain listener set rather than an `EventEmitter`, because subscribers here
 * are React components that mount and unmount freely. `EventEmitter`'s
 * max-listeners warning exists to catch leaks in long-lived wiring and only
 * produces false alarms against that pattern.
 */
class PromptPrefillProgressStore {
  private active: PromptPrefillProgress | null = null;
  private readonly listeners = new Set<PromptPrefillProgressListener>();

  /** The most recent report, or null if no request is currently reporting. */
  getActive(): PromptPrefillProgress | null {
    return this.active;
  }

  /** Subscribe to change notifications. Returns the unsubscribe function. */
  subscribe(listener: PromptPrefillProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  report(progress: PromptPrefillProgress): void {
    this.active = progress;
    this.notify();
  }

  /**
   * Mark the reporting request finished. Safe to call unconditionally, and
   * safe to call for requests that never reported — a no-op then, so callers
   * need no bookkeeping of their own.
   */
  finish(): void {
    if (this.active === null) return;
    this.active = null;
    this.notify();
  }

  private notify(): void {
    // Copy first: a listener is free to unsubscribe itself in response, and
    // mutating the set mid-iteration would skip its neighbour.
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

export const promptPrefillProgressService = new PromptPrefillProgressStore();
