import { describe, expect, it } from 'vitest';

import { fromInt16, peakHeight, peaksOfSamples, resamplePeaks, toInt16 } from './recording-audio';

describe('16-bit sample storage', () => {
  it('round-trips within one step and clips out-of-range values', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 1.7, -3]);
    const back = fromInt16(toInt16(samples));
    expect(back[1]).toBeCloseTo(0.5, 4);
    expect(back[2]).toBeCloseTo(-0.5, 4);
    expect(back[3]).toBe(1);
    expect(back[4]).toBe(-1);
    expect(back[5]).toBe(1);
    expect(back[6]).toBe(-1);
  });
});

describe('waveform peaks', () => {
  it('takes the loudest peak of each bar', () => {
    expect(resamplePeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
  });

  it('spreads a short recording over the whole strip', () => {
    expect(resamplePeaks([0.5, 0.25], 4)).toEqual([0.5, 0.5, 0.25, 0.25]);
    expect(resamplePeaks([], 3)).toEqual([0, 0, 0]);
  });

  it('keeps silence visible and quiet speech readable', () => {
    expect(peakHeight(0)).toBeGreaterThan(0);
    expect(peakHeight(0.1)).toBeGreaterThan(0.4);
    expect(peakHeight(1)).toBe(1);
  });

  it('measures decoded audio once per step', () => {
    const samples = new Float32Array(16_000 * 3);
    samples[16_000 + 8] = -0.8;
    expect(peaksOfSamples(samples, 16_000)).toEqual([0, 0.8, 0]);
  });
});
