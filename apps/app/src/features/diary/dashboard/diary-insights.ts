/**
 * What the doctor reads from a care diary: adherence, measurement series for charts, questionnaire
 * totals with their bands and alerts, and rows for a CSV/XLSX export. Pure functions over the
 * decrypted diary; scoring comes from the questionnaire schemas, not from code here.
 */
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import {
  addDays,
  CARE_DOSE_FIELD,
  dayKey,
  dayPlan,
  diaryStarted,
  doseValue,
  heatmapDays,
} from '@/features/diary/diary-care';
import {
  DIARY_MEAL_LABEL,
  DIARY_MISS_REASON_SHORT,
  type DiaryCheckpoint,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryMissReason,
  type DiaryPlanValue,
  describeDiaryEntry,
  markedDose,
} from '@/features/diary/diary-model';
import {
  loadCheckpointQuestionnaire,
  readyCheckpointQuestionnaire,
} from '@/features/diary/diary-questionnaires';
import { type AssessmentLimit, scoreScaleLimit } from '@/state/assessment-limits';

export interface Adherence {
  /** Marked share of the plan over the period, 0–1; undefined when nothing was planned. */
  readonly share: number | undefined;
  readonly done: number;
  readonly total: number;
}

/** Plan marked over the last `days` days up to today (today included). */
export function adherence(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  days: number,
  now: Date = new Date(),
): Adherence {
  const today = dayKey(now);
  // Days before the diary was issued asked for nothing; counting them would show 0 %.
  const window = addDays(today, -(days - 1));
  const issued = diaryStarted(invitation, entries);
  const heat = heatmapDays(invitation, entries, issued > window ? issued : window, today, now);
  const done = heat.reduce((sum, day) => sum + day.done, 0);
  const total = heat.reduce((sum, day) => sum + day.total, 0);
  return { share: total ? done / total : undefined, done, total };
}

export interface MedicineAdherence {
  readonly itemId: string;
  readonly name: string;
  readonly taken: number;
  readonly skipped: number;
  readonly planned: number;
  /** Why the skipped ones were skipped, as the patient said (DIARY22); unanswered ones are absent. */
  readonly reasons: Readonly<Partial<Record<DiaryMissReason, number>>>;
}

/** «забыл(а) ×2, закончилось» — the reasons, the most frequent first. */
export function missReasonsText(reasons: MedicineAdherence['reasons']): string {
  return (Object.entries(reasons) as [DiaryMissReason, number][])
    .toSorted((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${DIARY_MISS_REASON_SHORT[reason]}${count > 1 ? ` ×${count}` : ''}`)
    .join(', ');
}

/** Per medicine: planned intakes, taken and skipped over the last `days` days. */
export function medicineAdherence(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  days: number,
  now: Date = new Date(),
): MedicineAdherence[] {
  const today = dayKey(now);
  const started = diaryStarted(invitation, entries);
  const result = new Map<string, MedicineAdherence>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    if (day < started) continue;
    for (const task of dayPlan(invitation, entries, day, now).doses) {
      const current = result.get(task.item.id) ?? {
        itemId: task.item.id,
        name: [task.item.name, task.item.dose].filter(Boolean).join(' '),
        taken: 0,
        skipped: 0,
        planned: 0,
        reasons: {},
      };
      const reason =
        task.state === 'skipped' && task.entry ? doseValue(task.entry)?.reason : undefined;
      result.set(task.item.id, {
        ...current,
        planned: current.planned + (task.state === 'open' ? 0 : 1),
        taken: current.taken + (task.state === 'done' ? 1 : 0),
        skipped: current.skipped + (task.state === 'skipped' ? 1 : 0),
        reasons: reason
          ? { ...current.reasons, [reason]: (current.reasons[reason] ?? 0) + 1 }
          : current.reasons,
      });
    }
  }
  return [...result.values()];
}

export interface SeriesPoint {
  readonly at: string;
  readonly value: number;
}

/** A numeric field over time, optionally only from one checkpoint (morning vs evening). */
export function fieldSeries(
  entries: readonly DiaryEntry[],
  fieldId: string,
  check?: string,
): SeriesPoint[] {
  return entries
    .filter(
      (entry) =>
        (check === undefined || entry.check === check) && typeof entry.values[fieldId] === 'number',
    )
    .map((entry) => ({ at: entry.at, value: entry.values[fieldId] as number }))
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

export interface QuestionnairePoint {
  readonly at: string;
  readonly entryId: string;
  readonly total: number;
  readonly max: number;
  readonly headline: string;
  readonly alerts: readonly string[];
  /** The schema's alert notices with their explanations. */
  readonly alertDetails: readonly { readonly title: string; readonly message: string }[];
}

export interface QuestionnaireSeries {
  readonly checkpointId: string;
  /** Key of the doctor's red line: the questionnaire slug. */
  readonly limitId: string;
  /** The red line the questionnaire's schema declares (`scoreScaleLimit`). */
  readonly preset: AssessmentLimit | undefined;
  readonly title: string;
  /** Several scales and no one total (temperament, roles): shown by headline, not charted. */
  readonly profile: boolean;
  readonly points: readonly QuestionnairePoint[];
}

/** Scores one questionnaire checkpoint's answers with its definition; nothing when it has no totals. */
function scoreSeries(
  checkpoint: DiaryCheckpoint,
  answered: readonly DiaryEntry[],
  definition: AssessmentDefinition,
): QuestionnaireSeries | undefined {
  const points: QuestionnairePoint[] = [];
  for (const entry of answered) {
    const scored = scoreAssessment(definition, entry.answers ?? {}, entry.at);
    if (!scored.ok) continue;
    const primary =
      scored.value.scores.find((score) => scored.value.primaryScaleIds.includes(score.scaleId)) ??
      scored.value.scores[0];
    const main = definition.scales[0];
    const total = scored.value.scores.find((score) => score.scaleId === main?.id) ?? primary;
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
    });
  }
  // A questionnaire the doctor made without scores has nothing to chart.
  if (!points.length) return undefined;
  return {
    checkpointId: checkpoint.id,
    limitId: checkpoint.questionnaire ?? checkpoint.id,
    preset: scoreScaleLimit(definition),
    title: definition.shortTitle,
    profile: definition.scales.length > 1 && !definition.scoreScales?.length,
    points: points.toSorted((left, right) => left.at.localeCompare(right.at)),
  };
}

/**
 * Totals of every questionnaire checkpoint, scored with its schema (bands and alerts). With every
 * definition at hand the answer is the list itself, not a promise: a page that reads it as a
 * resource then never suspends, so the page behind it is not swapped for a skeleton.
 */
export function questionnaireSeries(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
): QuestionnaireSeries[] | Promise<QuestionnaireSeries[]> {
  const todo = (invitation.checkpoints ?? []).flatMap((checkpoint) => {
    if (checkpoint.kind !== 'questionnaire' || !checkpoint.questionnaire) return [];
    const answered = entries.filter((entry) => entry.check === checkpoint.id && entry.answers);
    return answered.length ? [{ checkpoint, answered }] : [];
  });
  const score = (definitions: readonly AssessmentDefinition[]): QuestionnaireSeries[] =>
    todo.flatMap(({ checkpoint, answered }, index) => {
      const definition = definitions[index];
      const series = definition ? scoreSeries(checkpoint, answered, definition) : undefined;
      return series ? [series] : [];
    });
  const known = todo.map(({ checkpoint }) => readyCheckpointQuestionnaire(checkpoint));
  if (known.every((definition) => definition !== undefined)) return score(known);
  return Promise.all(todo.map(({ checkpoint }) => loadCheckpointQuestionnaire(checkpoint))).then(
    score,
  );
}

export interface ExportRow {
  readonly date: string;
  readonly time: string;
  readonly kind: string;
  readonly what: string;
  readonly values: string;
  readonly note: string;
  readonly corrected: string;
}

export const EXPORT_COLUMNS: readonly { readonly key: keyof ExportRow; readonly title: string }[] =
  [
    { key: 'date', title: 'Дата' },
    { key: 'time', title: 'Время' },
    { key: 'kind', title: 'Вид' },
    { key: 'what', title: 'Что' },
    { key: 'values', title: 'Значения' },
    { key: 'note', title: 'Комментарий' },
    { key: 'corrected', title: 'Исправлено врачом' },
  ];

/** One row per entry, oldest first, in the doctor's words. */
export function exportRows(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
): ExportRow[] {
  return entries
    .toSorted((left, right) => left.at.localeCompare(right.at))
    .map((entry) => {
      const at = new Date(entry.at);
      const plan = entry.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
      const item = plan?.item
        ? invitation.plan?.find((candidate) => candidate.id === plan.item)
        : undefined;
      const checkpoint = entry.check
        ? invitation.checkpoints?.find((candidate) => candidate.id === entry.check)
        : undefined;
      const slot = item?.times?.find((time) => time.time === plan?.slot);
      const kind = plan
        ? 'Приём'
        : checkpoint?.kind === 'questionnaire'
          ? 'Опросник'
          : checkpoint
            ? 'Отметка'
            : 'Описание состояния';
      const what = plan
        ? [
            item?.name ?? plan.other,
            markedDose(invitation, plan),
            plan.slot ? `по плану ${plan.slot}` : '',
            slot?.meal ? DIARY_MEAL_LABEL[slot.meal] : '',
          ]
            .filter(Boolean)
            .join(', ')
        : (checkpoint?.label ?? '');
      return {
        date: at.toLocaleDateString('ru-RU'),
        time: at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        kind,
        what,
        values: plan
          ? plan.done === false
            ? 'пропущено'
            : 'принято'
          : describeDiaryEntry(invitation, entry),
        note: entry.note ?? '',
        corrected: entry.corrected ? 'да' : '',
      };
    });
}

function csvCell(value: string): string {
  return /[";\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV with `;` (opens correctly in Russian Excel), BOM for UTF-8. */
export function exportCsv(rows: readonly ExportRow[]): string {
  const lines = [
    EXPORT_COLUMNS.map((column) => column.title).join(';'),
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => csvCell(row[column.key])).join(';')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function exportXlsx(rows: readonly ExportRow[], sheetName: string): Promise<Blob> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Дневник');
  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.title,
    key: column.key,
    width: column.key === 'values' || column.key === 'note' ? 48 : 16,
  }));
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export interface AlertCause {
  /** Questionnaire short title. */
  readonly title: string;
  readonly point: QuestionnairePoint;
}

/**
 * The answers behind an urgent alert. The server only knows that and when an alert was raised; the
 * questionnaire entry with schema alerts saved last before it (a minute of clock slack) is its cause.
 */
export function alertCause(
  series: readonly QuestionnaireSeries[],
  alertAt: string,
): AlertCause | undefined {
  const limit = Date.parse(alertAt) + 60_000;
  let best: AlertCause | undefined;
  for (const one of series) {
    for (const point of one.points) {
      if (!point.alerts.length || Date.parse(point.at) > limit) continue;
      if (!best || point.at > best.point.at) best = { title: one.title, point };
    }
  }
  return best;
}
