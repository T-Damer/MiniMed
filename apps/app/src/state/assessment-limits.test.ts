import { beforeEach, describe, expect, it } from 'vitest';

import { loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';
import {
  assessmentLimit,
  crossesLimit,
  isOwnLimit,
  scoreScaleLimit,
  setAssessmentLimit,
} from '@/state/assessment-limits';

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

  it('takes a questionnaire line from its schema: the first band that needs attention', async () => {
    const lines = await Promise.all(
      ['phq-9', 'gad-7', 'zung-self-rating-depression', 'zung-self-rating-anxiety'].map(
        async (slug) => scoreScaleLimit(await loadDiaryQuestionnaire(slug))?.value,
      ),
    );
    expect(lines).toEqual([10, 10, 48, 40]);
    const phq = scoreScaleLimit(await loadDiaryQuestionnaire('phq-9'));
    expect(crossesLimit('phq-9', 9, phq)).toBe(false);
    expect(crossesLimit('phq-9', 10, phq)).toBe(true);
  });

  it('points a line down when only the lowest bands worry', () => {
    const definition = {
      scales: [{ id: 'total', label: 'Сумма', shortLabel: 'Сумма', description: '' }],
      scoreScales: [
        {
          id: 'track',
          valueId: 'total',
          minimum: 0,
          maximum: 30,
          layout: 'proportional' as const,
          bands: [
            { from: 0, attentionLevel: 'high' as const },
            { from: 10, attentionLevel: 'none' as const },
          ],
        },
      ],
    };
    expect(scoreScaleLimit(definition)).toEqual({ value: 9, direction: 'below' });
    expect(scoreScaleLimit({ scales: [] })).toBeUndefined();
  });

  it('uses the clinical cut-offs for measurements, saturation worrying from below', () => {
    expect(crossesLimit('spo2', 93)).toBe(true);
    expect(crossesLimit('spo2', 97)).toBe(false);
    expect(assessmentLimit('unknown')).toBeUndefined();
  });

  it('keeps the doctor’s level, hides a line set to null and resets to the default', () => {
    setAssessmentLimit('pulse', 110);
    expect(isOwnLimit('pulse')).toBe(true);
    expect(crossesLimit('pulse', 105)).toBe(false);
    setAssessmentLimit('pulse', null);
    expect(assessmentLimit('pulse')).toBeUndefined();
    setAssessmentLimit('pulse', undefined);
    expect(assessmentLimit('pulse')?.value).toBe(100);
    expect(isOwnLimit('pulse')).toBe(false);
    setAssessmentLimit('phq-9', 12);
    expect(assessmentLimit('phq-9', { value: 10, direction: 'above' })?.value).toBe(12);
  });
});
