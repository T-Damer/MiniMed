import { beforeEach, describe, expect, it } from 'vitest';

import { loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';
import {
  assessmentBounds,
  crossesLimit,
  isOwnLimit,
  resetAssessmentLimit,
  scoreScaleLimit,
  setAssessmentBound,
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
    expect(assessmentBounds('spo2')).toEqual({ below: 94 });
    expect(crossesLimit('spo2', 93)).toBe(true);
    expect(crossesLimit('spo2', 97)).toBe(false);
    expect(assessmentBounds('weight')).toEqual({});
  });

  it('takes the doctor’s lines above and below for any value', () => {
    setAssessmentBound('pulse', 'below', 50);
    expect(assessmentBounds('pulse')).toEqual({ above: 100, below: 50 });
    expect(crossesLimit('pulse', 45)).toBe(true);
    expect(crossesLimit('pulse', 70)).toBe(false);
    setAssessmentBound('weight', 'above', 90);
    setAssessmentBound('weight', 'below', 60);
    expect(crossesLimit('weight', 58)).toBe(true);
    expect(crossesLimit('weight', 95)).toBe(true);
    expect(isOwnLimit('weight')).toBe(true);
  });

  it('hides a preset line with null and returns to the presets', () => {
    setAssessmentBound('pulse', 'above', null);
    expect(assessmentBounds('pulse')).toEqual({});
    expect(crossesLimit('pulse', 140)).toBe(false);
    setAssessmentBound('pulse', 'above', undefined);
    expect(assessmentBounds('pulse')).toEqual({ above: 100 });
    expect(isOwnLimit('pulse')).toBe(false);
    setAssessmentBound('phq-9', 'above', 12);
    setAssessmentBound('phq-9', 'below', 2);
    expect(assessmentBounds('phq-9', { value: 10, direction: 'above' })).toEqual({
      above: 12,
      below: 2,
    });
    resetAssessmentLimit('phq-9');
    expect(assessmentBounds('phq-9', { value: 10, direction: 'above' })).toEqual({ above: 10 });
  });
});
