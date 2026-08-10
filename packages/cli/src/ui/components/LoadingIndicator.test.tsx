/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { act } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { LoadingIndicator } from './LoadingIndicator.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { afterEach, beforeEach, vi } from 'vitest';
import { promptPrefillProgressService } from '@qwen-code/qwen-code-core';
import * as useTerminalSize from '../hooks/useTerminalSize.js';

// Mock GeminiRespondingSpinner
vi.mock('./GeminiRespondingSpinner.js', () => ({
  GeminiRespondingSpinner: ({
    nonRespondingDisplay,
  }: {
    nonRespondingDisplay?: string;
  }) => {
    const streamingState = React.useContext(StreamingContext)!;
    if (streamingState === StreamingState.Responding) {
      return <Text>MockRespondingSpinner</Text>;
    } else if (nonRespondingDisplay) {
      return <Text>{nonRespondingDisplay}</Text>;
    }
    return null;
  },
  // The idle-prefill row uses the raw spinner directly: it must animate even
  // though the streaming state is Idle, which GeminiRespondingSpinner will
  // not do.
  GeminiSpinner: () => <Text>MockSpinner</Text>,
}));

vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(),
}));

const useTerminalSizeMock = vi.mocked(useTerminalSize.useTerminalSize);

const renderWithContext = (
  ui: React.ReactElement,
  streamingStateValue: StreamingState,
  width = 120,
) => {
  useTerminalSizeMock.mockReturnValue({ columns: width, rows: 24 });
  const contextValue: StreamingState = streamingStateValue;
  return render(
    <StreamingContext.Provider value={contextValue}>
      {ui}
    </StreamingContext.Provider>,
  );
};

describe('<LoadingIndicator />', () => {
  const defaultProps = {
    currentLoadingPhrase: 'Loading...',
    elapsedTime: 5,
  };

  it('should not render when streamingState is Idle', () => {
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...defaultProps} />,
      StreamingState.Idle,
    );
    expect(lastFrame()).toBe('');
  });

  it('should render spinner, phrase, and time when streamingState is Responding', () => {
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...defaultProps} />,
      StreamingState.Responding,
    );
    const output = lastFrame();
    expect(output).toContain('MockRespondingSpinner');
    expect(output).toContain('Loading...');
    expect(output).toContain('5s');
    expect(output).toContain('esc to cancel');
  });

  it('should render spinner (static), phrase but no time/cancel when streamingState is WaitingForConfirmation', () => {
    const props = {
      currentLoadingPhrase: 'Confirm action',
      elapsedTime: 10,
    };
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...props} />,
      StreamingState.WaitingForConfirmation,
    );
    const output = lastFrame();
    expect(output).toContain('⠏'); // Static char for WaitingForConfirmation
    expect(output).toContain('Confirm action');
    expect(output).not.toContain('(esc to cancel)');
    expect(output).not.toContain('10s');
  });

  it('should display the currentLoadingPhrase correctly', () => {
    const props = {
      currentLoadingPhrase: 'Processing data...',
      elapsedTime: 3,
    };
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...props} />,
      StreamingState.Responding,
    );
    expect(lastFrame()).toContain('Processing data...');
  });

  it('should display whole elapsed seconds below one minute', () => {
    const half = renderWithContext(
      <LoadingIndicator currentLoadingPhrase="Working..." elapsedTime={17.5} />,
      StreamingState.Responding,
    );
    expect(half.lastFrame()).toContain('(17s · esc to cancel)');

    const whole = renderWithContext(
      <LoadingIndicator currentLoadingPhrase="Working..." elapsedTime={18} />,
      StreamingState.Responding,
    );
    expect(whole.lastFrame()).toContain('(18s · esc to cancel)');

    // Timer start / reset publishes exactly 0.
    const zero = renderWithContext(
      <LoadingIndicator currentLoadingPhrase="Working..." elapsedTime={0} />,
      StreamingState.Responding,
    );
    expect(zero.lastFrame()).toContain('(0s · esc to cancel)');
  });

  it('should display the elapsedTime correctly when Responding', () => {
    const props = {
      currentLoadingPhrase: 'Working...',
      elapsedTime: 60,
    };
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...props} />,
      StreamingState.Responding,
    );
    expect(lastFrame()).toContain('(1m · esc to cancel)');
  });

  it('should display the elapsedTime correctly in human-readable format', () => {
    const props = {
      currentLoadingPhrase: 'Working...',
      elapsedTime: 125,
    };
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...props} />,
      StreamingState.Responding,
    );
    expect(lastFrame()).toContain('(2m 5s · esc to cancel)');
  });

  it('should render rightContent when provided', () => {
    const rightContent = <Text>Extra Info</Text>;
    const { lastFrame } = renderWithContext(
      <LoadingIndicator {...defaultProps} rightContent={rightContent} />,
      StreamingState.Responding,
    );
    expect(lastFrame()).toContain('Extra Info');
  });

  it('should transition correctly between states using rerender', () => {
    const { lastFrame, rerender } = renderWithContext(
      <LoadingIndicator {...defaultProps} />,
      StreamingState.Idle,
    );
    expect(lastFrame()).toBe(''); // Initial: Idle

    // Transition to Responding
    rerender(
      <StreamingContext.Provider value={StreamingState.Responding}>
        <LoadingIndicator
          currentLoadingPhrase="Now Responding"
          elapsedTime={2}
        />
      </StreamingContext.Provider>,
    );
    let output = lastFrame();
    expect(output).toContain('MockRespondingSpinner');
    expect(output).toContain('Now Responding');
    expect(output).toContain('(2s · esc to cancel)');

    // Transition to WaitingForConfirmation
    rerender(
      <StreamingContext.Provider value={StreamingState.WaitingForConfirmation}>
        <LoadingIndicator
          currentLoadingPhrase="Please Confirm"
          elapsedTime={15}
        />
      </StreamingContext.Provider>,
    );
    output = lastFrame();
    expect(output).toContain('⠏');
    expect(output).toContain('Please Confirm');
    expect(output).not.toContain('(esc to cancel)');
    expect(output).not.toContain('15s');

    // Transition back to Idle
    rerender(
      <StreamingContext.Provider value={StreamingState.Idle}>
        <LoadingIndicator {...defaultProps} />
      </StreamingContext.Provider>,
    );
    expect(lastFrame()).toBe('');
  });

  it('should truncate long primary text instead of wrapping', () => {
    const { lastFrame } = renderWithContext(
      <LoadingIndicator
        {...defaultProps}
        currentLoadingPhrase={
          'This is an extremely long loading phrase that should be truncated in the UI to keep the primary line concise.'
        }
      />,
      StreamingState.Responding,
      80,
    );

    expect(lastFrame()).toMatchSnapshot();
  });

  describe('responsive layout', () => {
    it('should render on a single line on a wide terminal', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          rightContent={<Text>Right</Text>}
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      // Check for single line output
      expect(output?.includes('\n')).toBe(false);
      expect(output).toContain('Loading...');
      expect(output).toContain('(5s · esc to cancel)');
      expect(output).toContain('Right');
    });

    it('should render on multiple lines on a narrow terminal', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          rightContent={<Text>Right</Text>}
        />,
        StreamingState.Responding,
        79,
      );
      const output = lastFrame();
      const lines = output?.split('\n');
      // Expecting 3 lines:
      // 1. Spinner + Primary Text
      // 2. Cancel + Timer
      // 3. Right Content
      expect(lines).toHaveLength(3);
      if (lines) {
        expect(lines[0]).toContain('Loading...');
        expect(lines[0]).not.toContain('5s');
        expect(lines[1]).toContain('5s');
        expect(lines[2]).toContain('Right');
      }
    });

    it('should use wide layout at 80 columns', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
        80,
      );
      expect(lastFrame()?.includes('\n')).toBe(false);
    });

    it('should use narrow layout at 79 columns', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
        79,
      );
      expect(lastFrame()?.includes('\n')).toBe(true);
    });
  });

  describe('token display', () => {
    it('should display output tokens inline with arrow notation', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={847} />,
        StreamingState.Responding,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 847 tokens');
      expect(output).not.toContain('↑');
      expect(output).toContain('5s');
      expect(output).toContain('esc to cancel');
    });

    it('should not display tokens when output tokens is 0', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={0} />,
        StreamingState.Responding,
      );
      const output = lastFrame();
      expect(output).not.toContain('↓');
      expect(output).not.toContain('tokens');
    });

    it('should not display tokens when props are undefined', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      const output = lastFrame();
      expect(output).not.toContain('↓');
      expect(output).not.toContain('tokens');
    });

    it('should hide tokens in narrow terminal', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={500} />,
        StreamingState.Responding,
        79,
      );
      const output = lastFrame();
      expect(output).not.toContain('↓');
      expect(output).not.toContain('tokens');
      expect(output).toContain('esc to cancel');
    });

    it('should show tokens in wide terminal with inline format', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={5400} />,
        StreamingState.Responding,
        80,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 5.4k tokens');
    });

    it('should format tokens inline with time and cancel', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={5400} />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('(5s · ↓ 5.4k tokens · esc to cancel)');
    });

    it('should not show response tokens/sec by default', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={500} />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 500 tokens');
      expect(output).not.toContain('t/s');
    });

    it('should show response tokens/sec when enabled', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          candidatesTokens={500}
          showResponseTokensPerSecond
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 500 tokens');
      expect(output).toContain('100 t/s');
    });

    it('should calculate response tokens/sec from tokens produced after the timer reset', () => {
      const streamingCharsRef = { current: 400 };
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          candidatesTokens={550}
          taskStartTokens={500}
          taskStartStreamingChars={200}
          streamingCharsRef={streamingCharsRef}
          isStreaming
          showResponseTokensPerSecond
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 650 tokens');
      expect(output).toContain('20 t/s');
      expect(output).not.toContain('130 t/s');
    });

    it('should not count excluded tool tokens toward response tokens/sec', () => {
      const streamingCharsRef = { current: 400 };
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          candidatesTokens={8000}
          taskStartTokens={8000}
          streamingCharsRef={streamingCharsRef}
          isStreaming
          showResponseTokensPerSecond
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 8.1k tokens');
      expect(output).toContain('20 t/s');
      expect(output).not.toContain('1620 t/s');
    });

    it('should format sub-10 response tokens/sec with one decimal place', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          currentLoadingPhrase="Working..."
          elapsedTime={8}
          candidatesTokens={25}
          showResponseTokensPerSecond
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('3.1 t/s');
    });

    it('should not show response tokens/sec before content arrives', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          candidatesTokens={500}
          showResponseTokensPerSecond
          isReceivingContent={false}
        />,
        StreamingState.Responding,
        120,
      );
      const output = lastFrame();
      expect(output).toContain('↑ 500 tokens');
      expect(output).not.toContain('t/s');
    });

    it('should show ↑ arrow when waiting for API response', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator
          {...defaultProps}
          candidatesTokens={500}
          isReceivingContent={false}
        />,
        StreamingState.Responding,
      );
      const output = lastFrame();
      expect(output).toContain('↑ 500 tokens');
      expect(output).not.toContain('↓');
    });

    it('should show ↓ arrow when receiving content (default)', () => {
      const { lastFrame } = renderWithContext(
        <LoadingIndicator {...defaultProps} candidatesTokens={500} />,
        StreamingState.Responding,
      );
      const output = lastFrame();
      expect(output).toContain('↓ 500 tokens');
      expect(output).not.toContain('↑');
    });
  });

  describe('prompt prefill progress', () => {
    // Fake timers throughout: the hook re-renders on a 200ms ticker while a
    // report is active, and under real timers `act()` never settles because
    // there is always another frame scheduled.
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      promptPrefillProgressService.finish();
      vi.useRealTimers();
    });

    const TOTAL = 41592;

    /** Report at `processed`, stamped now, so nothing is extrapolated yet. */
    const reportPrefill = (processed: number) => {
      promptPrefillProgressService.report({
        total: TOTAL,
        cache: 0,
        processed,
        timeMs: (processed / 350) * 1000,
        receivedAt: Date.now(),
      });
    };

    it('replaces the loading phrase with a bar while prefilling', () => {
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        reportPrefill(17000);
      });

      const output = lastFrame();
      expect(output).toContain('Prefilling context');
      expect(output).toContain('40%'); // 17000 / 41592, floored
      expect(output).toContain('\u2593');
      expect(output).toContain('\u2591');
      // The witty phrase is what this displaces — that is the whole point.
      expect(output).not.toContain('Loading...');
      // The cancel affordance must survive; it is the only way out of a
      // multi-minute prefill.
      expect(output).toContain('esc to cancel');
      unmount();
    });

    it('shows an ETA once one is worth showing', () => {
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        reportPrefill(17000); // ~24.6k left at 350 t/s => ~1m 10s
      });

      expect(lastFrame()).toContain('left');
      unmount();
    });

    it('advances between server reports instead of freezing', () => {
      // The server reports once per prompt batch — seconds apart. A bar that
      // sat still between them would read as a hang.
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        reportPrefill(17000);
      });
      const before = lastFrame();

      act(() => {
        vi.advanceTimersByTime(3000); // no new report, just elapsed time
      });

      expect(lastFrame()).not.toBe(before);
      expect(lastFrame()).toContain('Prefilling context');
      unmount();
    });

    it('never reaches 100% on extrapolation alone', () => {
      // Only the server knows it finished. A bar pinned at 100% during a
      // continuing wait is the failure this feature exists to prevent.
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        reportPrefill(30000);
      });
      act(() => {
        // Far longer than the projected remainder, so extrapolation is
        // pinned against its ceiling rather than tracking the server.
        vi.advanceTimersByTime(120_000);
      });

      expect(lastFrame()).not.toContain('100%');
      expect(lastFrame()).toContain('99%');
      unmount();
    });

    it('restores the loading phrase once prefill finishes', () => {
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        reportPrefill(17000);
      });
      expect(lastFrame()).toContain('Prefilling context');

      act(() => {
        promptPrefillProgressService.finish();
      });

      expect(lastFrame()).toContain('Loading...');
      expect(lastFrame()).not.toContain('Prefilling context');
      unmount();
    });

    it('stays quiet for a prompt served from cache', () => {
      // A fully cached prompt reports processed == total immediately.
      // Flashing a bar for one frame is worse than never showing one.
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
      );
      act(() => {
        promptPrefillProgressService.report({
          total: TOTAL,
          cache: 41500,
          processed: TOTAL,
          timeMs: 120,
          receivedAt: Date.now(),
        });
      });

      expect(lastFrame()).toContain('Loading...');
      expect(lastFrame()).not.toContain('Prefilling context');
      unmount();
    });

    it('renders during Idle while the startup prompt is warming', () => {
      // The warm request fires at launch with no user turn behind it, so the
      // app is Idle while the GPU is saturated for minutes. Without this the
      // session looks completely inert.
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toBe('');

      act(() => {
        reportPrefill(17000);
      });

      const output = lastFrame();
      expect(output).toContain('Prefilling context');
      expect(output).toContain('40%');
      // Reduced row: there is no turn to time and nothing for esc to cancel.
      expect(output).not.toContain('esc to cancel');
      expect(output).not.toContain('Loading...');
      unmount();
    });

    it('goes back to rendering nothing when an idle warm finishes', () => {
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Idle,
      );
      act(() => {
        reportPrefill(17000);
      });
      expect(lastFrame()).toContain('Prefilling context');

      act(() => {
        promptPrefillProgressService.finish();
      });

      expect(lastFrame()).toBe('');
      unmount();
    });

    it('drops the bar on a narrow terminal but keeps the percentage', () => {
      const { lastFrame, unmount } = renderWithContext(
        <LoadingIndicator {...defaultProps} />,
        StreamingState.Responding,
        30,
      );
      act(() => {
        reportPrefill(17000);
      });

      const output = lastFrame();
      expect(output).toContain('40%');
      expect(output).not.toContain('\u2593');
      unmount();
    });
  });
});
