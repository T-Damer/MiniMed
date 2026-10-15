import type { ToolEvaluation } from '@localmed/contracts';
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
            lowerInclusive: true,
            upperInclusive: true,
            sourceIds: [],
          },
        }),
      ),
    ).toEqual({ title: 'Умеренная активность', text: '35–64 балла.' });
  });

  it('does not repeat a verdict the page already shows as its headline and summary', () => {
    const verdict = evaluation({
      status: 'verdict',
      verdict: {
        rangeId: 'moderate',
        title: 'Умеренная активность',
        explanation: '35–64 балла.',
        attentionLevel: 'moderate',
        lowerInclusive: true,
        upperInclusive: true,
        sourceIds: [],
      },
    });
    expect(
      evaluationNotice(verdict, { headline: 'Умеренная активность', summary: '35–64 балла.' }),
    ).toBeUndefined();
    expect(
      evaluationNotice(verdict, { headline: 'Умеренная активность', summary: 'Другой текст.' }),
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

  it('says nothing for a result declared not applicable', () => {
    expect(
      evaluationNotice(
        evaluation({ status: 'not-applicable', reason: 'Результат — расчётный объём жидкости.' }),
      ),
    ).toBeUndefined();
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
    const declaredOf = (record: { readonly definition: unknown }): ToolEvaluation | undefined =>
      (record.definition as { readonly evaluation?: ToolEvaluation }).evaluation;
    const undeclared = loadToolModuleRecords().filter(
      (record) => record.kind === 'assessment' && declaredOf(record)?.status === 'unavailable',
    );
    // Every shipped assessment now declares a verdict or a reason; an `unavailable` one (should a
    // future tool ship without rules) must stay silent too.
    expect(
      evaluationNotice(evaluation({ status: 'unavailable', reason: 'Правила не объявлены.' })),
    ).toBeUndefined();
    for (const record of undeclared) {
      const declared = declaredOf(record);
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
