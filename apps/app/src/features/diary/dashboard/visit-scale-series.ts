/**
 * The doctor's visit ratings as chart series: each scale scored with its own schema from the tool
 * bank (totals, bands, answers), like the patient's questionnaires, labelled as the doctor's.
 */
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import {
  type QuestionnairePoint,
  type QuestionnaireSeries,
  questionnaireAnswers,
} from '@/features/diary/dashboard/diary-insights';
import type { DiaryEntry } from '@/features/diary/diary-model';
import { diaryQuestionnaire, loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';
import { scoreScaleLimit } from '@/state/assessment-limits';

/** The chart id of one scale's visit series. */
export function visitSeriesId(scale: string): string {
  return `visit-${scale}`.slice(0, 40);
}

/** Scores the ratings of every listed scale; a scale the app does not know is left out. */
export async function visitScaleSeries(
  visits: readonly DiaryEntry[],
): Promise<QuestionnaireSeries[]> {
  const scales = [
    ...new Set(visits.flatMap((entry) => (entry.visitScale ? [entry.visitScale] : []))),
  ]
    .filter((slug) => diaryQuestionnaire(slug) !== undefined)
    .toSorted();
  const series: QuestionnaireSeries[] = [];
  for (const slug of scales) {
    const definition = await loadDiaryQuestionnaire(slug);
    const points: QuestionnairePoint[] = [];
    for (const entry of visits) {
      if (entry.visitScale !== slug) continue;
      const scored = scoreAssessment(definition, entry.answers ?? {}, entry.at);
      if (!scored.ok) continue;
      const main = definition.scales[0];
      const total =
        scored.value.scores.find((score) => score.scaleId === main?.id) ?? scored.value.scores[0];
      if (!total) continue;
      points.push({
        at: entry.at,
        entryId: entry.id,
        total: total.rawScore,
        max: total.maximumScore,
        headline: scored.value.headline,
        alerts: (scored.value.alerts ?? []).map((alert) => alert.title),
        alertDetails: (scored.value.alerts ?? []).map((alert) => ({
          title: alert.title,
          message: alert.message,
        })),
        answers: questionnaireAnswers(definition, entry.answers ?? {}),
      });
    }
    if (!points.length) continue;
    series.push({
      checkpointId: visitSeriesId(slug),
      limitId: slug,
      preset: scoreScaleLimit(definition),
      title: `${definition.shortTitle}, оценка врача`,
      profile: false,
      points: points.toSorted((left, right) => left.at.localeCompare(right.at)),
    });
  }
  return series;
}
