import { describe, expect, it } from 'vitest';

import { SPEECH_SAMPLE_RATE, SpeechSegmenter } from './speech-windows';

const seconds = (value: number): number => Math.round(value * SPEECH_SAMPLE_RATE);

/** A tone loud enough for speech, or near-silence, of the given length. */
function sound(length: number, loud: boolean): Float32Array {
  const out = new Float32Array(seconds(length));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = loud ? 0.2 * Math.sin(index / 7) : 0.0005 * Math.sin(index / 3);
  }
  return out;
}

function feed(segmenter: SpeechSegmenter, ...parts: Float32Array[]) {
  // Arrives in the recorder's 50 ms batches.
  const windows = [];
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += 800) {
      windows.push(...segmenter.push(part.subarray(offset, offset + 800)));
    }
  }
  return windows;
}

describe('SpeechSegmenter', () => {
  it('drops silence before speech, keeping a short pre-roll, and keeps absolute positions', () => {
    const segmenter = new SpeechSegmenter();
    const windows = feed(segmenter, sound(5, false), sound(3, true), sound(2, false));
    expect(windows).toHaveLength(1);
    const [window] = windows;
    // Speech began at 5 s; the stretch starts ~0.3 s before it, not at 0.
    expect(window?.startSample).toBeGreaterThan(seconds(4.6));
    expect(window?.startSample).toBeLessThan(seconds(5));
    // It ends just after the speech (tail ~0.3 s), not after the whole pause.
    const end = (window?.startSample ?? 0) + (window?.samples.length ?? 0);
    expect(end).toBeGreaterThan(seconds(8));
    expect(end).toBeLessThan(seconds(8.5));
    expect(window?.speechSeconds).toBeGreaterThan(2.8);
  });

  it('cuts a long turn at a short pause once it has reached its minimum, not mid-speech', () => {
    const segmenter = new SpeechSegmenter({ minSeconds: 8 });
    const windows = feed(
      segmenter,
      sound(5, true),
      sound(0.3, false), // too early to cut
      sound(4, true),
      sound(0.6, false), // past 8 s: cut here
      sound(3, true),
    );
    expect(windows).toHaveLength(1);
    const end = (windows[0]?.startSample ?? 0) + (windows[0]?.samples.length ?? 0);
    expect(end).toBeGreaterThan(seconds(9.3));
    expect(end).toBeLessThan(seconds(9.9));
    const tail = segmenter.flush();
    // The rest of the pause before the next words is trimmed to the pre-roll.
    expect(tail?.startSample).toBeGreaterThanOrEqual(end);
    expect(tail?.startSample).toBeLessThan(end + seconds(0.2));
    expect(tail?.speechSeconds).toBeGreaterThan(2.8);
  });

  it('ends a monologue without pauses at its maximum length', () => {
    const segmenter = new SpeechSegmenter({ maxSeconds: 10 });
    const windows = feed(segmenter, sound(25, true));
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const window of windows) {
      expect(window.samples.length).toBeLessThanOrEqual(seconds(10.1));
    }
    // Stretches follow each other without gaps or overlap.
    expect(windows[1]?.startSample).toBe(
      (windows[0]?.startSample ?? 0) + (windows[0]?.samples.length ?? 0),
    );
  });

  it('is done with everything after the end, trailing silence included', () => {
    const segmenter = new SpeechSegmenter();
    feed(segmenter, sound(2, true), sound(1, false));
    expect(segmenter.flush()?.speechSeconds).toBeGreaterThan(1.8);
    expect(segmenter.position).toBe(seconds(3));
  });

  it('hands out nothing for silence, and advances its position past it', () => {
    const segmenter = new SpeechSegmenter();
    expect(feed(segmenter, sound(30, false))).toHaveLength(0);
    expect(segmenter.flush()).toBeNull();
    expect(segmenter.position).toBe(seconds(30));
  });

  it('starts counting from a given sample (a stored recording read from the middle)', () => {
    const segmenter = new SpeechSegmenter({}, seconds(600));
    const windows = feed(segmenter, sound(2, true), sound(2, false));
    expect(windows[0]?.startSample).toBe(seconds(600));
  });
});
