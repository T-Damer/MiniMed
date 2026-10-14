import type { AssessmentEvaluation } from '@/features/assessments/assessment-types';

export interface EvaluationNotice {
  readonly title: string;
  readonly text: string;
}

/**
 * What the declared evaluation tells the reader on a result page. Only a verdict, a context the
 * reader can still supply, or a declared reason why the result does not apply is shown. A tool
 * schema that never declared evaluation rules says nothing: the score and its interpretation stand
 * alone, and no note about what the schema lacks (a pipeline detail) reaches the screen.
 */
export function evaluationNotice(
  evaluation: AssessmentEvaluation | undefined,
): EvaluationNotice | undefined {
  if (!evaluation) return undefined;
  if (evaluation.status === 'verdict') {
    const verdict = evaluation.verdict;
    const text = verdict?.explanation ?? evaluation.reason;
    return text ? { title: verdict?.title ?? 'Оценка результата', text } : undefined;
  }
  if (evaluation.status === 'missing-context') {
    const text = evaluation.missingContext.join(' ').trim();
    return text ? { title: 'Не хватает данных для оценки', text } : undefined;
  }
  if (evaluation.status === 'not-applicable' && evaluation.reason) {
    return { title: 'Оценка не применяется', text: evaluation.reason };
  }
  return undefined;
}
