import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendLiveLine,
  isSilent,
  LIVE_MAX_WINDOW_SECONDS,
  LIVE_MIN_WINDOW_SECONDS,
  LIVE_SAMPLE_RATE,
  type LiveStatus,
  planLiveWindow,
  startLiveTranscriber,
} from './live-transcription';

const seconds = (value: number): number => value * LIVE_SAMPLE_RATE;

describe('planLiveWindow', () => {
  it('waits until enough new audio has arrived', () => {
    expect(planLiveWindow(seconds(LIVE_MIN_WINDOW_SECONDS - 1), 0)).toBeNull();
    expect(planLiveWindow(seconds(10), seconds(5))).toBeNull();
  });

  it('takes everything new, up to one speech window', () => {
    expect(planLiveWindow(seconds(10), 0)).toEqual({ from: 0, to: seconds(10) });
    expect(planLiveWindow(seconds(100), seconds(10))).toEqual({
      from: seconds(10),
      to: seconds(10 + LIVE_MAX_WINDOW_SECONDS),
    });
  });
});

describe('live text helpers', () => {
  it('treats quiet audio as silence and speech-level audio as sound', () => {
    expect(isSilent(new Float32Array(100))).toBe(true);
    expect(isSilent(new Float32Array(100).fill(0.2))).toBe(false);
    expect(isSilent(new Float32Array(0))).toBe(true);
  });

  it('appends trimmed lines and ignores empty text and an immediate repeat', () => {
    expect(appendLiveLine([], '  Добрый   день ')).toEqual(['Добрый день']);
    expect(appendLiveLine(['a'], '   ')).toEqual(['a']);
    expect(appendLiveLine(['a'], 'a')).toEqual(['a']);
  });
});

describe('startLiveTranscriber', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const loud = (length: number): Float32Array => new Float32Array(length).fill(0.3);

  it('reports unavailable until the model is ready, then recognises new audio', async () => {
    let ready = false;
    const statuses: LiveStatus[] = [];
    const lines: (readonly string[])[] = [];
    const recognise = vi.fn(async () => 'привет');
    const live = startLiveTranscriber({
      available: () => ready,
      snapshot: () => new Blob(),
      decode: async () => loud(seconds(8)),
      recognise,
      onLines: (next) => lines.push(next),
      onStatus: (status) => statuses.push(status),
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recognise).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('unavailable');
    ready = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recognise).toHaveBeenCalledTimes(1);
    expect(lines.at(-1)).toEqual(['привет']);
    expect(statuses.at(-1)).toBe('listening');
    live.stop();
  });

  it('retries a stretch that failed and stops after repeated failures', async () => {
    const recognise = vi.fn(async () => {
      throw new Error('boom');
    });
    const statuses: LiveStatus[] = [];
    const live = startLiveTranscriber({
      available: () => true,
      snapshot: () => new Blob(),
      decode: async () => loud(seconds(200)),
      recognise,
      onLines: () => undefined,
      onStatus: (status) => statuses.push(status),
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recognise).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('failed');
    live.stop();
  });

  it('reads the same stretch again after a failure instead of skipping it', async () => {
    const windows: number[] = [];
    let attempts = 0;
    const live = startLiveTranscriber({
      available: () => true,
      snapshot: () => new Blob(),
      decode: async () => loud(seconds(10)),
      recognise: async (samples) => {
        windows.push(samples.length);
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return 'текст';
      },
      onLines: () => undefined,
      onStatus: () => undefined,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(windows).toEqual([seconds(10), seconds(10)]);
    live.stop();
  });

  it('catches up on audio recorded before the model was ready without waiting a full interval', async () => {
    const lengths: number[] = [];
    const lines: (readonly string[])[] = [];
    const live = startLiveTranscriber({
      available: () => true,
      snapshot: () => new Blob(),
      decode: async () => loud(seconds(70)),
      recognise: async (samples) => {
        lengths.push(samples.length);
        return `часть ${lengths.length}`;
      },
      onLines: (next) => lines.push(next),
      onStatus: () => undefined,
      intervalMs: 7_000,
      backlogDelayMs: 100,
    });
    // One interval to start, then 28 s + 28 s + 14 s follow 100 ms apart.
    await vi.advanceTimersByTimeAsync(7_000 + 400);
    expect(lengths).toEqual([seconds(28), seconds(28), seconds(14)]);
    expect(lines.at(-1)).toEqual(['часть 1', 'часть 2', 'часть 3']);
    live.stop();
  });

  it('finish() reads the short tail left when the recording ends', async () => {
    const lengths: number[] = [];
    let total = seconds(9);
    const live = startLiveTranscriber({
      available: () => true,
      snapshot: () => new Blob(),
      decode: async () => loud(total),
      recognise: async (samples) => {
        lengths.push(samples.length);
        return `часть ${lengths.length}`;
      },
      onLines: () => undefined,
      onStatus: () => undefined,
      intervalMs: 7_000,
    });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(lengths).toEqual([seconds(9)]);
    // 2 s more are recorded, too short for a live step but worth reading at the end.
    total = seconds(11);
    await live.finish();
    expect(lengths).toEqual([seconds(9), seconds(2)]);
  });

  it('finish() does nothing when there is no model', async () => {
    const recognise = vi.fn(async () => 'x');
    const live = startLiveTranscriber({
      available: () => false,
      snapshot: () => new Blob(),
      decode: async () => loud(seconds(30)),
      recognise,
      onLines: () => undefined,
      onStatus: () => undefined,
    });
    await live.finish();
    expect(recognise).not.toHaveBeenCalled();
  });

  it('does not recognise silent audio', async () => {
    const recognise = vi.fn(async () => 'x');
    const live = startLiveTranscriber({
      available: () => true,
      snapshot: () => new Blob(),
      decode: async () => new Float32Array(seconds(10)),
      recognise,
      onLines: () => undefined,
      onStatus: () => undefined,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recognise).not.toHaveBeenCalled();
    live.stop();
  });
});
