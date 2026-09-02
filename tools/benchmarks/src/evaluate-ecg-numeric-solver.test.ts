import { describe, expect, it } from 'vitest';

import {
  type EcgNumericCaseResult,
  scoreEcgNumericClass,
  selectEcgSafetyNegativeCutoff,
} from './evaluate-ecg-numeric-solver';

function result(
  actual: boolean,
  probability: number,
  status: EcgNumericCaseResult['estimate']['status'],
): EcgNumericCaseResult {
  return {
    actual,
    estimate: { id: 'MI', label: 'MI', probability, status, threshold: 0.5 },
  };
}

describe('numeric ECG Solver metrics', () => {
  it('separates confident false negatives from abstentions', () => {
    const metrics = scoreEcgNumericClass([
      result(true, 0.9, 'positive'),
      result(true, 0.8, 'uncertain'),
      result(true, 0.7, 'negative'),
      result(false, 0.6, 'positive'),
      result(false, 0.2, 'uncertain'),
      result(false, 0.1, 'negative'),
    ]);

    expect(metrics).toMatchObject({
      positives: 3,
      negatives: 3,
      true_positive: 1,
      true_negative: 1,
      false_positive: 1,
      false_negative: 1,
      uncertain_positive: 1,
      uncertain_negative: 1,
      coverage: 4 / 6,
      sensitivity_answered: 0.5,
      confident_false_negative_rate: 1 / 3,
      auc: 1,
    });
  });

  it('selects the negative cutoff only from positive validation cases', () => {
    const validation = Array.from({ length: 20 }, (_, index) =>
      result(true, (index + 1) / 100, 'negative'),
    );
    validation.push(result(false, 0.001, 'negative'));

    expect(selectEcgSafetyNegativeCutoff(validation, 0.05)).toBeCloseTo(0.01, 10);
    expect(
      selectEcgSafetyNegativeCutoff(
        [result(true, 0.01, 'negative'), ...validation.slice(0, 19)],
        0.05,
      ),
    ).toBe(0);
  });
});
