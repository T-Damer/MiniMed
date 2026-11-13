import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_MAX_BACKLOG_SECONDS,
  type LiveStatus,
  startSpeechTranscriber,
  type TranscriptSegment,
} from './live-transcription';
import { SPEECH_SAMPLE_RATE } from './speech-windows';

const seconds = (value: number): number => Math.round(value * SPEECH_SAMPLE_RATE);

function sound(length: number, loud: boolean): Float32Array {
  const out = new Float32Array(seconds(length));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = loud ? 0.2 * Math.sin(index / 7) : 0;
  }
  return out;
}

/** One spoken turn: speech, then a pause long enough to end it. */
const turn = (length: number): Float32Array[] => [sound(length, true), sound(1.6, false)];

function push(target: { push(samples: Float32Array): void }, ...parts: Float32Array[]): void {
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += 800) {
      target.push(part.slice(offset, offset + 800));
    }
  }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

describe('startSpeechTranscriber', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recognises each turn with its place in the recording', async () => {
    const segments: (readonly TranscriptSegment[])[] = [];
    let call = 0;
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      recognise: async () => `Фраза ${++call}`,
      onSegments: (next) => segments.push(next),
      onStatus: () => undefined,
    });
    push(live, sound(2, false), ...turn(3), ...turn(4));
    await flush();
    const last = segments.at(-1) ?? [];
    expect(last.map((segment) => segment.text)).toEqual(['Фраза 1', 'Фраза 2']);
    expect(last[0]?.startMs).toBeGreaterThan(1600);
    expect(last[0]?.startMs).toBeLessThan(2000);
    expect(last[1]?.startMs).toBeGreaterThan(last[0]?.endMs ?? 0);
  });

  it('never sends silence, and drops what the model invents', async () => {
    const recognise = vi.fn(async () => 'Продолжение следует...');
    const onSegments = vi.fn();
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      recognise,
      onSegments,
      onStatus: () => undefined,
    });
    push(live, sound(40, false));
    await flush();
    expect(recognise).not.toHaveBeenCalled();
    push(live, ...turn(2));
    await flush();
    expect(recognise).toHaveBeenCalledTimes(1);
    expect(onSegments).not.toHaveBeenCalled();
    // The silence and the dropped stretch count as done.
    expect(live.transcribedUntil()).toBeGreaterThan(seconds(42));
  });

  it('keeps audio that came before the model and reads it once the model is ready', async () => {
    let ready = false;
    const statuses: LiveStatus[] = [];
    const recognise = vi.fn(async () => 'текст');
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => ready,
      recognise,
      onSegments: () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    push(live, ...turn(3), ...turn(3));
    await flush();
    expect(recognise).not.toHaveBeenCalled();
    expect(live.transcribedUntil()).toBe(0);
    ready = true;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(recognise).toHaveBeenCalledTimes(2);
    expect(statuses).toContain('working');
  });

  it('defers when the model reads slower than real time, keeping the place to resume from', async () => {
    let clock = 0;
    const statuses: LiveStatus[] = [];
    const progress: number[] = [];
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      now: () => clock,
      recognise: async (samples) => {
        clock += (samples.length / SPEECH_SAMPLE_RATE) * 1000 * 2; // twice real time
        return 'медленно';
      },
      onSegments: () => undefined,
      onStatus: (status) => statuses.push(status),
      onProgress: (at) => progress.push(at),
    });
    push(live, ...turn(3), ...turn(3), ...turn(3));
    await flush();
    expect(statuses.at(-1)).toBe('deferred');
    const resumeAt = live.transcribedUntil();
    expect(resumeAt).toBeGreaterThan(0);
    // Two turns were read before the governor stopped; the third waits for «Расшифровать».
    expect(resumeAt).toBeLessThan(seconds(3 * 4.6));
    push(live, ...turn(3));
    await flush();
    expect(live.transcribedUntil()).toBe(resumeAt);
    await live.finish();
    expect(progress.at(-1)).toBe(resumeAt);
  });

  it('defers when audio piles up behind a busy model', async () => {
    let release: (() => void) | undefined;
    const statuses: LiveStatus[] = [];
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      recognise: () =>
        new Promise<string>((resolve) => {
          release = () => resolve('ok');
        }),
      onSegments: () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    const turns = Math.ceil(LIVE_MAX_BACKLOG_SECONDS / 4) + 2;
    for (let index = 0; index < turns; index += 1) push(live, ...turn(3));
    release?.();
    await flush();
    expect(statuses.at(-1)).toBe('deferred');
  });

  it('defers at once when the device reports overload', async () => {
    const recognise = vi.fn(async () => 'x');
    const statuses: LiveStatus[] = [];
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      overloaded: () => true,
      recognise,
      onSegments: () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    push(live, ...turn(3));
    await flush();
    expect(recognise).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('deferred');
  });

  it('on request reads everything to the end, however slow, continuing earlier text', async () => {
    let clock = 0;
    const segments: (readonly TranscriptSegment[])[] = [];
    const run = startSpeechTranscriber({
      mode: 'request',
      available: () => true,
      startSample: seconds(60),
      initialSegments: [{ startMs: 1000, endMs: 4000, text: 'раньше' }],
      now: () => clock,
      recognise: async (samples) => {
        clock += (samples.length / SPEECH_SAMPLE_RATE) * 1000 * 3;
        return 'потом';
      },
      onSegments: (next) => segments.push(next),
      onStatus: () => undefined,
    });
    push(run, ...turn(3), ...turn(3), ...turn(3), sound(2, true));
    await run.finish();
    const last = segments.at(-1) ?? [];
    expect(last[0]?.text).toBe('раньше');
    expect(last.length).toBeGreaterThanOrEqual(2);
    expect(last[1]?.startMs).toBeGreaterThan(59_000);
    expect(run.status()).not.toBe('deferred');
  });

  it('finishing a live recording without a model leaves the rest for later', async () => {
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => false,
      recognise: async () => 'x',
      onSegments: () => undefined,
      onStatus: () => undefined,
    });
    push(live, ...turn(3));
    await live.finish();
    expect(live.status()).toBe('deferred');
    expect(live.transcribedUntil()).toBeLessThan(seconds(1));
  });

  it('gives up after repeated failures', async () => {
    const live = startSpeechTranscriber({
      mode: 'live',
      available: () => true,
      recognise: async () => {
        throw new Error('model crashed');
      },
      onSegments: () => undefined,
      onStatus: () => undefined,
    });
    push(live, ...turn(3));
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(live.status()).toBe('failed');
  });
});
