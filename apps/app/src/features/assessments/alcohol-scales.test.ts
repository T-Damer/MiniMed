import { beforeAll, describe, expect, it } from 'vitest';

import {
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

/** Answers to the scored questions of `scale` that add up to `total` (the first such set). */
function answersFor(
  definition: AssessmentDefinition,
  scale: string,
  total: number,
): Record<string, number> {
  const questions = definition.questions.filter((question) => question.scaleId === scale);
  const values = questions.map((question) =>
    (question.responseOptions ?? definition.responseOptions)
      .map((option) => option.value)
      .toSorted((left, right) => right - left),
  );
  const chosen: number[] = [];
  const fill = (index: number, left: number): boolean => {
    if (index === questions.length) return left === 0;
    for (const value of values[index] ?? []) {
      if (value > left) continue;
      chosen[index] = value;
      if (fill(index + 1, left - value)) return true;
    }
    return false;
  };
  if (!fill(0, total)) throw new Error(`No answers add up to ${total}.`);
  return Object.fromEntries(questions.map((question, index) => [question.id, chosen[index] ?? 0]));
}

async function levelsOf(
  slug: string,
  scale: string,
  sexQuestion: string,
  cases: readonly (readonly [sex: 0 | 1, total: number, rangeId: string])[],
): Promise<void> {
  const definition = await loadAssessmentDefinition(slug);
  for (const [sex, total, rangeId] of cases) {
    const result = scoreAssessment(definition, {
      ...answersFor(definition, scale, total),
      [sexQuestion]: sex,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.scores.find((score) => score.scaleId === scale)?.rawScore).toBe(total);
    expect([sex, total, result.value.evaluation?.verdict?.rangeId]).toEqual([sex, total, rangeId]);
    expect(result.value.headline).toBe(result.value.evaluation?.verdict?.title);
    // Sex picks the thresholds; it is not one of the result's scores.
    expect(result.value.scores.map((score) => score.scaleId)).toEqual([scale]);
  }
}

describe('alcohol questionnaires (NARCO1)', () => {
  it('RUS-AUDIT: the WHO 2021 levels, women and men apart, at every boundary', async () => {
    const definition = await loadAssessmentDefinition('rus-audit');
    expect(definition.questions).toHaveLength(11);
    expect(definition.questions[0]?.prompt).toBe('Как часто Вы употребляете алкогольные напитки?');
    expect(definition.questions[8]?.responseOptions?.map((option) => option.value)).toEqual([
      0, 2, 4,
    ]);
    // Table 8: women 0–4 / 5–9 / 10 / 11+, men 0–8 / 9–13 / 14–16 / 17+.
    await levelsOf('rus-audit', 'rus-audit-total', 'rus-audit-sex', [
      [0, 0, 'low-women'],
      [0, 4, 'low-women'],
      [0, 5, 'hazardous-women'],
      [0, 9, 'hazardous-women'],
      [0, 10, 'harmful-women'],
      [0, 11, 'dependence-women'],
      [0, 40, 'dependence-women'],
      [1, 8, 'low-men'],
      [1, 9, 'hazardous-men'],
      [1, 13, 'hazardous-men'],
      [1, 14, 'harmful-men'],
      [1, 16, 'harmful-men'],
      [1, 17, 'dependence-men'],
      [1, 40, 'dependence-men'],
    ]);
  });

  it('RUS-AUDIT-S: items 3, 9 and 10 with their own thresholds', async () => {
    const definition = await loadAssessmentDefinition('rus-audit-s');
    expect(definition.questions).toHaveLength(4);
    // Table 8: women 0–1 / 2–4 / 5 / 6+, men 0–3 / 4–6 / 7 / 8+.
    await levelsOf('rus-audit-s', 'rus-audit-s-total', 'rus-audit-s-sex', [
      [0, 1, 'low-women'],
      [0, 2, 'hazardous-women'],
      [0, 4, 'hazardous-women'],
      [0, 5, 'harmful-women'],
      [0, 6, 'dependence-women'],
      [0, 12, 'dependence-women'],
      [1, 3, 'low-men'],
      [1, 4, 'hazardous-men'],
      [1, 6, 'hazardous-men'],
      [1, 7, 'harmful-men'],
      [1, 8, 'dependence-men'],
    ]);
  });

  it('OCDS: each factor takes the larger answer of its paired items', async () => {
    const definition = await loadAssessmentDefinition('ocds-alcohol-craving');
    expect(definition.questions).toHaveLength(14);
    const zero = Object.fromEntries(definition.questions.map((question) => [question.id, 0]));
    const scored = (answers: Record<string, number>) => {
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      return Object.fromEntries(
        result.value.scores.map((score) => [
          score.scaleId,
          [score.rawScore, score.minimumScore, score.maximumScore],
        ]),
      );
    };
    expect(scored(zero)).toEqual({
      'ocds-total': [0, 0, 40],
      'ocds-obsessions': [0, 0, 20],
      'ocds-compulsions': [0, 0, 20],
    });
    // Items 1 and 2 count once (the larger), so do 7–8, 9–10 and 13–14.
    const paired = {
      ...zero,
      'ocds-01': 4,
      'ocds-02': 1,
      'ocds-03': 2,
      'ocds-07': 1,
      'ocds-08': 3,
      'ocds-13': 2,
      'ocds-14': 2,
    };
    expect(scored(paired)).toEqual({
      'ocds-total': [11, 0, 40],
      'ocds-obsessions': [6, 0, 20],
      'ocds-compulsions': [5, 0, 20],
    });
    const top = Object.fromEntries(definition.questions.map((question) => [question.id, 4]));
    expect(scored(top)['ocds-total']).toEqual([40, 0, 40]);
    expect(definition.evaluation?.status).toBe('not-applicable');
  });

  it('words the answers without blame', async () => {
    const definition = await loadAssessmentDefinition('ocds-alcohol-craving');
    const text = definition.questions
      .flatMap((question) => [
        question.prompt,
        ...(question.responseOptions ?? []).map((option) => option.label),
      ])
      .join('\n');
    expect(text).not.toMatch(/пьянств|алкоголик|злоупотреб/iu);
    expect(`${definition.evidenceNote}\n${definition.license?.notice}`).not.toMatch(
      /пьянств|алкоголик/iu,
    );
  });
});
