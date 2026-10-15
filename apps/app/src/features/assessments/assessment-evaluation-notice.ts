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
 * reaches the screen. A verdict whose title is the headline the page already shows is not written a
 * second time.
 */
export function evaluationNotice(
  evaluation: AssessmentEvaluation | undefined,
  shown?: { readonly headline: string; readonly summary: string },
): EvaluationNotice | undefined {
  if (!evaluation) return undefined;
  if (evaluation.status === 'verdict') {
    const verdict = evaluation.verdict;
    const text = verdict?.explanation ?? evaluation.reason;
    // The result already names the same band as its headline: one verdict, written once. Its own
    // summary is the fuller wording of that band, so a second explanation is not added beneath.
    if (verdict && shown && verdict.title === shown.headline) return undefined;
    return text ? { title: verdict?.title ?? 'Оценка результата', text } : undefined;
  }
  if (evaluation.status === 'missing-context') {
    const text = evaluation.missingContext.join(' ').trim();
    return text ? { title: 'Не хватает данных для оценки', text } : undefined;
  }
  return undefined;
}
