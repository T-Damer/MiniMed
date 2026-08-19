import { describe, expect, it } from 'vitest';

import { computePrintFitScale } from '@/features/printing/native-print-fit';

describe('computePrintFitScale', () => {
  it('returns 1 when content fits the sheet', () => {
    expect(computePrintFitScale(400, 600, 800, 1000)).toBe(1);
  });

  it('scales down tall content to fit sheet height', () => {
    expect(computePrintFitScale(400, 2000, 800, 1000)).toBe(0.5);
  });

  it('scales down wide content to fit sheet width', () => {
    expect(computePrintFitScale(1600, 400, 800, 1000)).toBe(0.5);
  });

  it('uses the tighter axis when both dimensions overflow', () => {
    expect(computePrintFitScale(1600, 2000, 800, 1000)).toBe(0.5);
  });

  it('never upscales content', () => {
    expect(computePrintFitScale(100, 100, 800, 1000)).toBe(1);
  });

  it('falls back to 1 for invalid measurements', () => {
    expect(computePrintFitScale(0, 100, 800, 1000)).toBe(1);
    expect(computePrintFitScale(Number.NaN, 100, 800, 1000)).toBe(1);
  });
});
