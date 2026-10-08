import { describe, expect, it } from 'vitest';

import { resolveRecordedDuration } from './recorded-duration';

function fakeAudio(duration: number) {
  const listeners = new Set<() => void>();
  const audio = {
    duration,
    currentTime: 0,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    audio,
    listeners,
    tick: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('resolveRecordedDuration', () => {
  it('leaves a file with a known length alone', () => {
    const { audio, listeners } = fakeAudio(12);
    resolveRecordedDuration(audio);
    expect(audio.currentTime).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it('seeks past the end of an unbounded recording and returns to the start once the length is known', () => {
    const { audio, listeners, tick } = fakeAudio(Number.POSITIVE_INFINITY);
    resolveRecordedDuration(audio);
    expect(audio.currentTime).toBeGreaterThan(1e6);
    tick();
    expect(listeners.size).toBe(1);
    audio.duration = 7.4;
    tick();
    expect(audio.currentTime).toBe(0);
    expect(listeners.size).toBe(0);
  });
});
