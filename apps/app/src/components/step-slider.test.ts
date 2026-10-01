import { describe, expect, it } from 'vitest';

import { stepFraction, stepIndexFromRange, stepIndexOf } from './step-slider';

describe('stepIndexOf', () => {
  it('finds an option and falls back to the first one', () => {
    expect(stepIndexOf(['off', 'slow', 'normal'], 'normal')).toBe(2);
    expect(stepIndexOf(['off', 'slow', 'normal'], 'missing')).toBe(0);
  });
});

describe('stepIndexFromRange', () => {
  it('rounds and clamps raw range values', () => {
    expect(stepIndexFromRange('2', 4)).toBe(2);
    expect(stepIndexFromRange('1.6', 4)).toBe(2);
    expect(stepIndexFromRange('9', 4)).toBe(3);
    expect(stepIndexFromRange('-1', 4)).toBe(0);
    expect(stepIndexFromRange('abc', 4)).toBe(0);
    expect(stepIndexFromRange('1', 0)).toBe(0);
  });
});

describe('stepFraction', () => {
  it('maps indices to track fractions', () => {
    expect(stepFraction(0, 4)).toBe(0);
    expect(stepFraction(3, 4)).toBe(1);
    expect(stepFraction(1, 3)).toBe(0.5);
    expect(stepFraction(0, 1)).toBe(0);
  });
});
