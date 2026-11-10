/**
 * Cohort export for a study (RESEARCH1): every diary of the doctor in one workbook, without names.
 * Each diary is named by a study code (a digest of the study name and the random diary id, so the
 * same diary keeps its code across exports of one study and no code leads back to a person
 * without the doctor's list), and time is the day of observation, day 0 being the diary's first
 * day, never a calendar date. Free text (notes, text answers, signa, the patient's own medicine
 * names) stays out: it can name people and places.
 *
 * Sheets: «Пациенты» (one row per diary), «Назначения» (each plan version × medicine: ATC codes,
 * target, dose per intake and per day), «Приём по дням» (per day and medicine: prescribed and
 * taken amounts, skips and their reasons), «Измерения» (numbers the patient entered: pressure,
 * pulse, weight, scores) and «Опросники» (questionnaire totals).
 */

import type { DiaryPlanRevision } from '@/features/diary/connected/diary-replica';
import { dayKey, diaryStarted } from '@/features/diary/diary-care';
import type {
  DiaryEntry,
  DiaryInvitation,
  DiaryPlanItem,
  DiaryResults,
} from '@/features/diary/diary-model';
import { DIARY_MISS_REASON_SHORT, type DiaryMissReason } from '@/features/diary/diary-model';
import { planOn } from '@/features/diary/plan-history';
import { adherence, type QuestionnaireSeries } from './diary-insights';
import { medicineIntake, parseDose } from './diary-intake';

/** One diary as the export reads it. */
export interface CohortDiary {
  /** The service's random diary id (never shown; only digested into the study code). */
  readonly id: string;
  readonly results: DiaryResults;
  readonly planHistory: readonly DiaryPlanRevision[];
  /** Questionnaire totals, scored by the caller (`questionnaireSeries`). */
  readonly quizzes: readonly QuestionnaireSeries[];
}

export type CohortCell = string | number;

export interface CohortSheet {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly CohortCell[])[];
}

/** `P-` and 8 hex digits of SHA-256(study + diary id). */
export async function studyCode(study: string, diaryId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${study.trim()}\u0000${diaryId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `P-${hex.toUpperCase()}`;
}

/** Whole days from `start` to `day` (both `YYYY-MM-DD`). */
function dayNumber(start: string, day: string): number {
  return Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000,
  );
}

export interface DailyDose {
  readonly amount: number;
  readonly unit: string;
  /** Intakes a day by the plan (0 for a medicine taken when needed). */
  readonly intakes: number;
}

/**
 * The dose a plan item prescribes per day: the sum of its intakes, each at its own dose when it
 * has one. Undefined when taken when needed, or when the intakes count in different units or a
 * dose has no number.
 */
export function dailyDose(item: DiaryPlanItem): DailyDose | undefined {
  const times = item.asNeeded ? [] : (item.times ?? []);
  if (!times.length) return undefined;
  const doses = times.map((time) => parseDose(time.dose ?? item.dose));
  const unit = doses[0]?.unit;
  if (!unit || unit === 'приём' || doses.some((dose) => dose.unit !== unit)) return undefined;
  const amount = doses.reduce((sum, dose) => sum + dose.amount, 0);
  return { amount: Math.round(amount * 1000) / 1000, unit, intakes: times.length };
}

function activeItems(invitation: DiaryInvitation): DiaryPlanItem[] {
  return (invitation.plan ?? []).filter((item) => !item.ended);
}

/** The most medicines in force at once over the plan's versions. */
function mostAtOnce(versions: readonly DiaryInvitation[]): number {
  return versions.reduce((most, version) => Math.max(most, activeItems(version).length), 0);
}

function planVersions(diary: CohortDiary): { at: string; invitation: DiaryInvitation }[] {
  const known = diary.planHistory.map((version) => ({
    at: version.at,
    invitation: version.invitation,
  }));
  return known.length
    ? known
    : [{ at: diary.results.invitation.issuedAt, invitation: diary.results.invitation }];
}

/** What changed for a medicine since the version before it. */
function itemChange(before: DiaryPlanItem | undefined, after: DiaryPlanItem): string {
  if (!before || before.ended) return 'назначен';
  if (after.ended) return 'отменён';
  const same =
    before.dose === after.dose &&
    JSON.stringify(before.times ?? []) === JSON.stringify(after.times ?? []) &&
    before.asNeeded === after.asNeeded;
  return same ? 'без изменений' : 'изменён';
}

const NUMBER_FIELD_SKIP = new Set(['height']);

function reasonsText(reasons: Partial<Record<DiaryMissReason, number>>): string {
  return (Object.entries(reasons) as [DiaryMissReason, number][])
    .map(([reason, count]) => `${DIARY_MISS_REASON_SHORT[reason]} ×${count}`)
    .join(', ');
}

export async function cohortSheets(
  study: string,
  diaries: readonly CohortDiary[],
  now: Date = new Date(),
): Promise<CohortSheet[]> {
  const patients: CohortCell[][] = [];
  const plans: CohortCell[][] = [];
  const intakes: CohortCell[][] = [];
  const measures: CohortCell[][] = [];
  const quizzes: CohortCell[][] = [];
  const today = dayKey(now);

  for (const diary of diaries) {
    const { invitation, entries } = diary.results;
    const code = await studyCode(study, diary.id);
    const start = diaryStarted(invitation, entries);
    const days = Math.max(1, dayNumber(start, today) + 1);
    const versions = planVersions(diary);
    const month = adherence(invitation, entries, 30, now);

    patients.push([
      code,
      days,
      activeItems(invitation).length,
      mostAtOnce(versions.map((version) => version.invitation)),
      versions.length,
      month.share === undefined ? '' : Math.round(month.share * 1000) / 10,
      entries.length,
    ]);

    // Plan versions: one row per medicine in force or just ended, with what changed.
    let previous: DiaryInvitation | undefined;
    versions.forEach((version, index) => {
      const before = new Map((previous?.plan ?? []).map((item) => [item.id, item]));
      for (const item of version.invitation.plan ?? []) {
        const was = before.get(item.id);
        if (item.ended && (!was || was.ended)) continue;
        const daily = dailyDose(item);
        plans.push([
          code,
          index + 1,
          dayNumber(start, dayKey(version.at)),
          item.id,
          item.name,
          (item.atc ?? []).join(' '),
          item.target ?? '',
          itemChange(was, item),
          item.dose ?? '',
          daily?.amount ?? '',
          daily?.unit ?? '',
          daily?.intakes ?? (item.asNeeded ? 0 : ''),
          item.asNeeded ? 'да' : '',
        ]);
      }
      previous = version.invitation;
    });

    // Intake per day and medicine over the whole diary, each day against the plan then in force.
    const atc = new Map(
      versions.flatMap((version) =>
        (version.invitation.plan ?? []).map((item) => [item.id, (item.atc ?? []).join(' ')]),
      ),
    );
    const history = medicineIntake(invitation, entries, days, now, (day) =>
      planOn(diary.planHistory, day, invitation),
    );
    for (const medicine of history) {
      for (const day of medicine.days) {
        const reasons: Partial<Record<DiaryMissReason, number>> = {};
        for (const skip of day.skipped ?? []) {
          if (skip.reason) reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1;
        }
        intakes.push([
          code,
          dayNumber(start, day.day),
          medicine.itemId,
          medicine.name,
          atc.get(medicine.itemId) ?? '',
          day.prescribed ?? '',
          day.taken,
          medicine.unit,
          day.skipped?.length ?? 0,
          reasonsText(reasons),
        ]);
      }
    }

    // Numbers the patient entered (pressure, pulse, weight, scores, lab results).
    const numeric = new Map(
      invitation.fields
        .filter((field) => field.type === 'number' && !NUMBER_FIELD_SKIP.has(field.id))
        .map((field) => [field.id, field]),
    );
    for (const entry of entries.toSorted((left, right) => left.at.localeCompare(right.at))) {
      for (const [id, value] of Object.entries(entry.values)) {
        const field = numeric.get(id);
        if (!field || typeof value !== 'number') continue;
        measures.push([
          code,
          dayNumber(start, dayKey(entry.at)),
          minutesOfDay(entry),
          field.id,
          field.label,
          value,
          field.unit ?? '',
          entry.corrected ? 'да' : '',
        ]);
      }
    }

    for (const series of diary.quizzes) {
      if (series.profile) continue;
      for (const point of series.points) {
        quizzes.push([
          code,
          dayNumber(start, dayKey(point.at)),
          series.limitId,
          series.title,
          point.total,
          point.max,
        ]);
      }
    }
  }

  return [
    {
      name: 'Пациенты',
      columns: [
        'Код',
        'Дней наблюдения',
        'Препаратов сейчас',
        'Больше всего препаратов одновременно',
        'Версий плана',
        'Приём по плану за 30 дней, %',
        'Записей',
      ],
      rows: patients,
    },
    {
      name: 'Назначения',
      columns: [
        'Код',
        'Версия плана',
        'День',
        'Пункт',
        'Препарат',
        'АТХ',
        'Мишень',
        'Изменение',
        'Доза на приём',
        'Доза в сутки',
        'Единица',
        'Приёмов в сутки',
        'При необходимости',
      ],
      rows: plans,
    },
    {
      name: 'Приём по дням',
      columns: [
        'Код',
        'День',
        'Пункт',
        'Препарат',
        'АТХ',
        'Назначено',
        'Принято',
        'Единица',
        'Пропусков',
        'Причины пропусков',
      ],
      rows: intakes,
    },
    {
      name: 'Измерения',
      columns: [
        'Код',
        'День',
        'Минута суток',
        'Поле',
        'Что',
        'Значение',
        'Единица',
        'Исправлено врачом',
      ],
      rows: measures,
    },
    {
      name: 'Опросники',
      columns: ['Код', 'День', 'Шкала', 'Название', 'Сумма', 'Максимум'],
      rows: quizzes,
    },
  ];
}

/** Minutes since local midnight: the time of day without the date. */
function minutesOfDay(entry: DiaryEntry): number {
  const at = new Date(entry.at);
  return at.getHours() * 60 + at.getMinutes();
}

/** The workbook of `cohortSheets`. */
export async function cohortXlsx(sheets: readonly CohortSheet[]): Promise<Blob> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  for (const sheet of sheets) {
    const page = workbook.addWorksheet(sheet.name.slice(0, 31));
    page.columns = sheet.columns.map((title) => ({
      header: title,
      width: Math.max(10, title.length + 2),
    }));
    for (const row of sheet.rows) page.addRow([...row]);
    page.getRow(1).font = { bold: true };
    page.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
