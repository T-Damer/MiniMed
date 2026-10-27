/**
 * What the doctor reads from a care diary: adherence, measurement series for charts, questionnaire
 * totals with their bands and alerts, and rows for a CSV/XLSX export. Pure functions over the
 * decrypted diary; scoring comes from the questionnaire schemas, not from code here.
 */
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import {
  addDays,
  CARE_DOSE_FIELD,
  dayKey,
  dayPlan,
  heatmapDays,
} from '@/features/diary/diary-care';
import {
  DIARY_MEAL_LABEL,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryPlanValue,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import { loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';

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
  const heat = heatmapDays(invitation, entries, addDays(today, -(days - 1)), today, now);
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
}

/** Per medicine: planned intakes, taken and skipped over the last `days` days. */
export function medicineAdherence(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  days: number,
  now: Date = new Date(),
): MedicineAdherence[] {
  const today = dayKey(now);
  const result = new Map<string, MedicineAdherence>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    if (day < dayKey(invitation.issuedAt)) continue;
    for (const task of dayPlan(invitation, entries, day, now).doses) {
      const current = result.get(task.item.id) ?? {
        itemId: task.item.id,
        name: [task.item.name, task.item.dose].filter(Boolean).join(' '),
        taken: 0,
        skipped: 0,
        planned: 0,
      };
      result.set(task.item.id, {
        ...current,
        planned: current.planned + (task.state === 'open' ? 0 : 1),
        taken: current.taken + (task.state === 'done' ? 1 : 0),
        skipped: current.skipped + (task.state === 'skipped' ? 1 : 0),
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
}

export interface QuestionnaireSeries {
  readonly checkpointId: string;
  readonly title: string;
  readonly points: readonly QuestionnairePoint[];
}

/** Totals of every questionnaire checkpoint, scored with its schema (bands and alerts). */
export async function questionnaireSeries(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
): Promise<QuestionnaireSeries[]> {
  const series: QuestionnaireSeries[] = [];
  for (const checkpoint of invitation.checkpoints ?? []) {
    if (checkpoint.kind !== 'questionnaire' || !checkpoint.questionnaire) continue;
    const answered = entries.filter((entry) => entry.check === checkpoint.id && entry.answers);
    if (!answered.length) continue;
    const definition = await loadDiaryQuestionnaire(checkpoint.questionnaire);
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
      });
    }
    series.push({
      checkpointId: checkpoint.id,
      title: definition.shortTitle,
      points: points.toSorted((left, right) => left.at.localeCompare(right.at)),
    });
  }
  return series;
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
            item?.dose,
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
