import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSPECTION_STALL_BASE_MS,
  INSPECTION_STALL_MAX_MS,
  InspectionCancelledError,
  InspectionStalledError,
  inspectionStallMs,
  runWithProgressWatchdog,
} from '@/state/user-library-watchdog';

describe('inspectionStallMs', () => {
  it('gives a small file the base time and a big one more, up to a cap', () => {
    expect(inspectionStallMs(0)).toBe(INSPECTION_STALL_BASE_MS);
    expect(inspectionStallMs(1024)).toBeGreaterThanOrEqual(INSPECTION_STALL_BASE_MS);
    expect(inspectionStallMs(5.5 * 1024 * 1024)).toBeGreaterThan(inspectionStallMs(1024 * 1024));
    expect(inspectionStallMs(5.5 * 1024 * 1024)).toBeLessThan(INSPECTION_STALL_MAX_MS);
    expect(inspectionStallMs(10 * 1024 * 1024 * 1024)).toBe(INSPECTION_STALL_MAX_MS);
  });

  it('survives nonsense sizes', () => {
    expect(inspectionStallMs(Number.NaN)).toBe(INSPECTION_STALL_BASE_MS);
    expect(inspectionStallMs(-5)).toBe(INSPECTION_STALL_BASE_MS);
  });
});

describe('runWithProgressWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the task result and leaves no timer behind', async () => {
    const result = await runWithProgressWatchdog(async (progress) => {
      progress.touch();
      return 42;
    }, 1000);
    expect(result).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the task failure through', async () => {
    await expect(
      runWithProgressWatchdog(async () => {
        throw new Error('битый файл');
      }, 1000),
    ).rejects.toThrow('битый файл');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails a task that makes no progress for the stall time', async () => {
    const cancelled = vi.fn();
    const outcome = runWithProgressWatchdog(async (progress) => {
      progress.onCancel(cancelled);
      await new Promise<never>(() => undefined);
    }, 60_000);
    const assertion = expect(outcome).rejects.toBeInstanceOf(InspectionStalledError);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cancelled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(cancelled).toHaveBeenCalledTimes(1);
    await expect(outcome).rejects.toThrow('60 с');
  });

  it('keeps a task alive for as long as it reports progress', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcome = runWithProgressWatchdog(async (progress) => {
      for (let step = 0; step < 5; step += 1) {
        await vi.advanceTimersByTimeAsync(40_000);
        progress.touch();
      }
      await gate;
      return 'готово';
    }, 60_000);
    // 200 s passed, far beyond one stall period, yet every step reported progress.
    await vi.advanceTimersByTimeAsync(0);
    release();
    await expect(outcome).resolves.toBe('готово');
  });

  it('stops an abandoned task at its next write', async () => {
    let afterStall: Error | undefined;
    let resumeTask: () => void = () => undefined;
    const outcome = runWithProgressWatchdog(async (progress) => {
      await new Promise<void>((resolve) => {
        resumeTask = resolve;
      });
      try {
        progress.assertActive();
      } catch (cause) {
        afterStall = cause as Error;
        throw cause;
      }
    }, 1000);
    const assertion = expect(outcome).rejects.toBeInstanceOf(InspectionStalledError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    resumeTask();
    await vi.advanceTimersByTimeAsync(0);
    expect(afterStall).toBeInstanceOf(InspectionCancelledError);
  });

  it('runs a cancel callback registered after the stall at once', async () => {
    let late: (() => void) | undefined;
    const outcome = runWithProgressWatchdog(async (progress) => {
      late = () => progress.onCancel(lateCallback);
      await new Promise<never>(() => undefined);
    }, 500);
    const lateCallback = vi.fn();
    const assertion = expect(outcome).rejects.toBeInstanceOf(InspectionStalledError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    late?.();
    expect(lateCallback).toHaveBeenCalledTimes(1);
  });
});
