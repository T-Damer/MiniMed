import type { AssessmentEvaluation } from '@/features/assessments/assessment-types';

export interface EvaluationNotice {
  readonly title: string;
  readonly text: string;
}

/**
 * What the declared evaluation tells the reader on a result page. Only a verdict or a context the
 * reader can still supply is shown. A result declared `not-applicable` (a dose, a volume, a
 * conversion) and a tool schema that never declared evaluation rules say nothing: the number and
 * its interpretation stand alone, and no note about what the schema lacks (a pipeline detail)
 * reaches the screen.
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
  return undefined;
}
