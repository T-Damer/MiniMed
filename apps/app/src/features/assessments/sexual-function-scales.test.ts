import { beforeAll, describe, expect, it } from 'vitest';

import {
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

async function scored(slug: string, answers: Readonly<Record<string, number>>) {
  const definition = await loadAssessmentDefinition(slug);
  const result = scoreAssessment(definition, answers);
  if (!result.ok) throw new Error(result.error);
  const scoreOf = (scale: string): number | undefined =>
    result.value.scores.find((score) => score.scaleId === scale)?.rawScore;
  return { definition, result: result.value, scoreOf };
}

/** `prefix-01 … prefix-NN` answered with `values`. */
function answers(prefix: string, values: readonly number[]): Record<string, number> {
  return Object.fromEntries(
    values.map((value, index) => [`${prefix}-${String(index + 1).padStart(2, '0')}`, value]),
  );
}

describe('sexual function questionnaires', () => {
  it('ASEX sums five items of 1–6 and applies the three criteria of the scale', async () => {
    const cases: readonly (readonly [readonly number[], number, string])[] = [
      // Nothing met: total 15, no item of 5–6, no three items of 4+.
      [[3, 3, 3, 3, 3], 15, 'no-dysfunction'],
      // Total of 19 or more.
      [[4, 4, 4, 4, 3], 19, 'dysfunction'],
      // One item of 5 with a low total.
      [[1, 1, 5, 1, 1], 9, 'dysfunction'],
      // Three items of 4 with a total under 19.
      [[4, 4, 4, 1, 1], 14, 'dysfunction'],
      // Two items of 4 are not enough.
      [[4, 4, 3, 3, 3], 17, 'no-dysfunction'],
    ];
    for (const [values, total, rangeId] of cases) {
      const { result, scoreOf } = await scored('asex', answers('asex', values));
      expect(scoreOf('asex-total')).toBe(total);
      expect([values, result.evaluation?.verdict?.rangeId]).toEqual([values, rangeId]);
    }
  });

  it('ASEX offers six answers scored 1 to 6 for every item', async () => {
    const definition = await loadAssessmentDefinition('asex');
    expect(definition.questions).toHaveLength(5);
    for (const question of definition.questions) {
      expect(question.responseOptions?.map((option) => option.value)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('СФМ: the average sample is 9/9/9 + 3 = 30', async () => {
    // Section VI keeps half points through a code twice the score: 3 points is code 6.
    const { result, scoreOf } = await scored('sfm', answers('sfm', [3, 3, 3, 3, 3, 6, 3, 3, 3, 3]));
    expect([scoreOf('sfm-g1'), scoreOf('sfm-g2'), scoreOf('sfm-g3')]).toEqual([9, 9, 9]);
    expect(scoreOf('sfm-duration')).toBe(3);
    expect(scoreOf('sfm-total')).toBe(30);
    expect(result.evaluation?.verdict?.rangeId).toBe('at-norm');
    // The steps of the count are not listed as results.
    expect(result.scores.map((score) => score.scaleId).toSorted()).toEqual([
      'sfm-duration',
      'sfm-g1',
      'sfm-g2',
      'sfm-g3',
      'sfm-total',
    ]);
  });

  it('СФМ: section VI scores 0, 0.5, 1, 2, 2.5, 3 and 4', async () => {
    const definition = await loadAssessmentDefinition('sfm');
    const codes = definition.questions[5]?.responseOptions?.map((option) => option.value) ?? [];
    const points: number[] = [];
    for (const code of codes) {
      const { scoreOf } = await scored('sfm', answers('sfm', [0, 0, 0, 0, 0, code, 0, 0, 0, 0]));
      points.push(scoreOf('sfm-g2') ?? Number.NaN);
    }
    expect(points).toEqual([0, 0.5, 1, 2, 2.5, 3, 4]);
    const low = await scored('sfm', answers('sfm', [2, 2, 2, 2, 2, 5, 2, 2, 2, 1]));
    expect(low.scoreOf('sfm-total')).toBe(19.5);
    expect(low.result.evaluation?.verdict?.rangeId).toBe('below-norm');
  });

  it('СФЖ: the average sample is 6/6/6/6 + 3 = 27', async () => {
    // VII: 3 points is code 6; VIII: 3 points is code 7.
    const { result, scoreOf } = await scored('sff', answers('sff', [3, 3, 3, 3, 3, 3, 6, 7, 3]));
    expect([scoreOf('sff-g1'), scoreOf('sff-g2'), scoreOf('sff-g3'), scoreOf('sff-g4')]).toEqual([
      6, 6, 6, 6,
    ]);
    expect(scoreOf('sff-total')).toBe(27);
    expect(result.evaluation?.verdict?.rangeId).toBe('at-norm');
  });

  it('СФЖ: sections VII and VIII keep their half points and the two zero answers', async () => {
    const definition = await loadAssessmentDefinition('sff');
    const pointsOf = async (question: number): Promise<number[]> => {
      const codes =
        definition.questions[question - 1]?.responseOptions?.map((option) => option.value) ?? [];
      const points: number[] = [];
      for (const code of codes) {
        const values = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        values[question - 1] = code;
        const { scoreOf } = await scored('sff', answers('sff', values));
        points.push(scoreOf('sff-g4') ?? Number.NaN);
      }
      return points;
    };
    expect(await pointsOf(7)).toEqual([0, 0.5, 1, 2, 3, 4]);
    expect(await pointsOf(8)).toEqual([0, 0, 0.5, 1, 2, 3, 4]);
  });
});
