import { beforeEach, describe, expect, it } from 'vitest';

import { assessmentLimit, crossesLimit, setAssessmentLimit } from '@/state/assessment-limits';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  },
  configurable: true,
});

describe('assessment red lines', () => {
  beforeEach(() => memory.clear());

  it('uses the clinical defaults, saturation worrying from below', () => {
    expect(assessmentLimit('phq-9')).toEqual({ value: 10, direction: 'above' });
    expect(crossesLimit('spo2', 93)).toBe(true);
    expect(crossesLimit('spo2', 97)).toBe(false);
    expect(assessmentLimit('unknown')).toBeUndefined();
  });

  it('keeps the doctor’s level, hides a line set to null and resets to the default', () => {
    setAssessmentLimit('pulse', 110);
    expect(crossesLimit('pulse', 105)).toBe(false);
    setAssessmentLimit('pulse', null);
    expect(assessmentLimit('pulse')).toBeUndefined();
    setAssessmentLimit('pulse', undefined);
    expect(assessmentLimit('pulse')?.value).toBe(100);
  });
});
