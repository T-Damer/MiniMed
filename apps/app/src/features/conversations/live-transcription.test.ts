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

  it('skips silence, does not re-read committed audio and stops after repeated failures', async () => {
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
    expect(statuses.at(-1)).toBe('unavailable');
    live.stop();
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
