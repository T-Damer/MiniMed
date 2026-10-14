import { describe, expect, it } from 'vitest';

import { evaluationNotice } from '@/features/assessments/assessment-evaluation-notice';
import type { AssessmentEvaluation } from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function evaluation(patch: Partial<AssessmentEvaluation>): AssessmentEvaluation {
  return { status: 'unavailable', missingContext: [], sourceIds: [], ...patch };
}

describe('the evaluation note of a result page', () => {
  it('shows a declared verdict with its explanation', () => {
    expect(
      evaluationNotice(
        evaluation({
          status: 'verdict',
          verdict: {
            rangeId: 'moderate',
            title: 'Умеренная активность',
            explanation: '35–64 балла.',
            attentionLevel: 'moderate',
            sourceIds: [],
          },
        }),
      ),
    ).toEqual({ title: 'Умеренная активность', text: '35–64 балла.' });
  });

  it('asks only for context the reader can still supply', () => {
    expect(
      evaluationNotice(
        evaluation({ status: 'missing-context', missingContext: ['Укажите возраст ребёнка.'] }),
      ),
    ).toEqual({ title: 'Не хватает данных для оценки', text: 'Укажите возраст ребёнка.' });
    expect(evaluationNotice(evaluation({ status: 'missing-context' }))).toBeUndefined();
  });

  it('says nothing when the schema declared no evaluation rules', () => {
    expect(
      evaluationNotice(
        evaluation({
          reason:
            'Для этого результата ещё не объявлены декларативные правила оценки; шкала и её пороги показаны только как справочная интерпретация.',
        }),
      ),
    ).toBeUndefined();
    expect(evaluationNotice(undefined)).toBeUndefined();
  });

  it('never surfaces a pipeline note of any shipped tool', () => {
    const records = loadToolModuleRecords();
    const undeclared = records.filter(
      (record) =>
        record.kind === 'assessment' && record.definition.evaluation?.status === 'unavailable',
    );
    // The audit behind the fix: assessments whose schema declares no evaluation rules.
    expect(undeclared.length).toBeGreaterThan(0);
    for (const record of undeclared) {
      const declared = record.definition.evaluation;
      expect(
        evaluationNotice({
          status: declared?.status ?? 'unavailable',
          missingContext: declared?.missingContext ?? [],
          sourceIds: declared?.sourceIds ?? [],
          ...(declared?.reason ? { reason: declared.reason } : {}),
        }),
        record.id,
      ).toBeUndefined();
    }
  });
});
