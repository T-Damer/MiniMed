/**
 * The doctor's charts of a diary, declared as data (owner 2026-10-28: «schema» first, so the main
 * app's patient card can draw the same charts). A chart names its series by diary field (and
 * checkpoint, for morning versus evening), its red lines by limit id (`state/assessment-limits`;
 * every chart has some, so the doctor can set «выше» and «ниже» for any value)
 * and its axis ranges; `TrendChart` renders any of them and the page never branches on a chart.
 * Questionnaire charts come from the questionnaire schemas instead (`questionnaireSeries`).
 */

import type { ChartMark } from '@/features/diary/dashboard/chart-marks';
import { fieldSeries, type SeriesPoint } from '@/features/diary/dashboard/diary-insights';
import type { IntakeSkip, MedicineIntake } from '@/features/diary/dashboard/diary-intake';
import { DIARY_MISS_REASON_SHORT, type DiaryEntry } from '@/features/diary/diary-model';
import { SUBSTANCES, USE_CRAVING_FIELD } from '@/features/diary/diary-substances';

export interface DiaryChartSeries {
  /** Diary field charted. */
  readonly field: string;
  /** Only entries of this checkpoint (`am`, `pm`); all entries when absent. */
  readonly check?: string;
  readonly label: string;
  /** CSS custom property of the line colour. */
  readonly color: string;
  readonly axis?: 'right';
}

export interface DiaryChartLimit {
  /** Limit id in `state/assessment-limits`. */
  readonly id: string;
  readonly unit?: string;
  readonly axis?: 'right';
}

export interface DiaryChart {
  readonly id: string;
  readonly title: string;
  readonly series: readonly DiaryChartSeries[];
  readonly limits?: readonly DiaryChartLimit[];
  /** One value per day (substance amounts): straight lines and the day, not the time, in the tip. */
  readonly daily?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly rightMin?: number;
  readonly rightMax?: number;
}

export const DIARY_CHARTS: readonly DiaryChart[] = [
  {
    id: 'wellbeing',
    title: 'Самочувствие (0–10)',
    min: 0,
    max: 10,
    series: [
      { field: 'wellbeing', check: 'am', label: 'Утром', color: '--theme-accent' },
      { field: 'wellbeing', check: 'pm', label: 'Вечером', color: '--theme-warning' },
    ],
    limits: [{ id: 'wellbeing' }],
  },
  {
    id: 'mood',
    title: 'Настроение (0–10)',
    min: 0,
    max: 10,
    series: [{ field: 'mood', label: 'Настроение', color: '--theme-info' }],
    limits: [{ id: 'mood' }],
  },
  {
    id: 'weight',
    title: 'Вес, кг',
    series: [{ field: 'weight', label: 'Вес', color: '--theme-accent' }],
    // No usual cut-off: the doctor sets the patient's own lines («выше», «ниже»).
    limits: [{ id: 'weight', unit: 'кг' }],
  },
  {
    id: 'pressure',
    title: 'Давление, мм рт. ст.',
    series: [
      // Red is kept for the red lines and the days past them.
      { field: 'systolic', label: 'Верхнее', color: '--theme-info' },
      { field: 'diastolic', label: 'Нижнее', color: '--theme-warning' },
    ],
    limits: [
      { id: 'systolic', unit: 'мм рт. ст.' },
      { id: 'diastolic', unit: 'мм рт. ст.' },
    ],
  },
  {
    id: 'pulse-spo2',
    title: 'Пульс и сатурация',
    rightMin: 85,
    rightMax: 100,
    series: [
      { field: 'pulse', label: 'Пульс, уд/мин', color: '--theme-accent' },
      { field: 'spo2', label: 'SpO₂, %', color: '--theme-info', axis: 'right' },
    ],
    limits: [
      { id: 'pulse', unit: 'уд/мин' },
      { id: 'spo2', unit: '%', axis: 'right' },
    ],
  },
  {
    id: 'glucose',
    title: 'Глюкоза, ммоль/л',
    series: [{ field: 'glucose', label: 'Глюкоза', color: '--theme-accent' }],
    limits: [{ id: 'glucose', unit: 'ммоль/л' }],
  },
  {
    id: 'activity',
    title: 'Активность',
    daily: true,
    min: 0,
    rightMin: 0,
    series: [
      { field: 'steps', label: 'Шаги', color: '--theme-accent' },
      { field: 'activity', label: 'Активные минуты', color: '--theme-info', axis: 'right' },
    ],
    // No usual cut-off: the doctor sets the patient's own lines.
    limits: [{ id: 'steps', unit: 'шагов' }],
  },
  {
    id: 'meals',
    title: 'Питание',
    daily: true,
    min: 0,
    rightMin: 0,
    rightMax: 10,
    series: [
      { field: 'meals', label: 'Приёмов пищи', color: '--theme-warning' },
      { field: 'appetite', label: 'Аппетит (0–10)', color: '--theme-info', axis: 'right' },
    ],
    limits: [{ id: 'appetite', axis: 'right' }],
  },
  {
    id: 'craving',
    title: 'Тяга (0–10)',
    min: 0,
    max: 10,
    series: [{ field: USE_CRAVING_FIELD, label: 'Тяга', color: '--theme-danger' }],
    limits: [{ id: USE_CRAVING_FIELD }],
  },
  // One chart per substance from the catalog: amounts differ in unit, and a chart appears only
  // when the patient has marked that substance.
  ...SUBSTANCES.map(
    (substance): DiaryChart => ({
      id: `use-${substance.id}`,
      title: `${substance.label}, ${substance.unit[2]} в день`,
      daily: true,
      min: 0,
      series: [{ field: substance.field, label: substance.label, color: '--theme-warning' }],
      // No usual cut-off: the doctor sets the patient's own line.
      limits: [{ id: substance.field, unit: substance.unit[2] }],
    }),
  ),
];

export interface ChartedSeries extends DiaryChartSeries {
  readonly points: readonly SeriesPoint[];
}

/** The chart's series over these entries; empty when none of them has a point. */
export function chartSeries(chart: DiaryChart, entries: readonly DiaryEntry[]): ChartedSeries[] {
  const series = chart.series.map((one) => ({
    ...one,
    points: fieldSeries(entries, one.field, one.check),
  }));
  return series.some((one) => one.points.length) ? series : [];
}

/** How one medicine's intake chart is drawn: its two series, declared like the charts above. */
export const INTAKE_CHART = {
  taken: { label: 'Принято', color: '--theme-accent', style: 'line' },
  prescribed: { label: 'Назначено', color: '--theme-text-muted', style: 'target' },
} as const;

export interface IntakeChart {
  readonly id: string;
  readonly title: string;
  readonly series: readonly {
    readonly label: string;
    readonly color: string;
    readonly style: 'line' | 'dots' | 'target';
    readonly points: readonly SeriesPoint[];
  }[];
  /** The intakes the patient marked as skipped: red crosses on the «Принято» line (DIARY23). */
  readonly marks: readonly ChartMark[];
}

/** A point at the middle of a local day, so daily values sit between the date ticks. */
function middayOf(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

/** «Пропущен приём» or «Пропущено приёмов: 3». */
export function skipTitle(count: number): string {
  return count === 1 ? 'Пропущен приём' : `Пропущено приёмов: ${count}`;
}

/**
 * The card lines of skipped intakes: «08:00 · 50 мг — закончилось» (the medicine first when the
 * card is not about one medicine), then the patient's own words in quotes.
 */
export function skipLines(skips: readonly IntakeSkip[], name?: string): string[] {
  return skips.flatMap((skip) => {
    const what = [name, skip.time, skip.dose].filter(Boolean).join(' · ');
    const line = skip.reason ? `${what} — ${DIARY_MISS_REASON_SHORT[skip.reason]}` : what;
    return skip.note ? [line, `«${skip.note}»`] : [line];
  });
}

/** One chart per medicine: the dose taken per day as a line, the prescribed dose dotted. */
export function intakeCharts(intakes: readonly MedicineIntake[]): IntakeChart[] {
  return intakes
    .filter((intake) => intake.days.length > 0)
    .map((intake) => ({
      id: intake.itemId,
      title: `${intake.name}, ${intake.unit} в день`,
      series: [
        {
          ...INTAKE_CHART.taken,
          points: intake.days.map((day) => ({ at: middayOf(day.day), value: day.taken })),
        },
        {
          ...INTAKE_CHART.prescribed,
          points: intake.days.flatMap((day) =>
            day.prescribed === undefined ? [] : [{ at: middayOf(day.day), value: day.prescribed }],
          ),
        },
      ].filter((series) => series.points.length > 0),
      marks: intake.days.flatMap((day) =>
        day.skipped?.length
          ? [
              {
                at: middayOf(day.day),
                value: day.taken,
                day: day.day,
                title: skipTitle(day.skipped.length),
                lines: skipLines(day.skipped),
              },
            ]
          : [],
      ),
    }));
}

/**
 * The skipped intakes of every medicine, one cross per day, for the combined chart: the cross sits
 * at `heightOf(day)` (that day's share of the plan) and its card names each medicine.
 */
export function skipMarks(
  intakes: readonly MedicineIntake[],
  heightOf: (day: string) => number,
): ChartMark[] {
  const byDay = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const intake of intakes) {
    for (const day of intake.days) {
      if (!day.skipped?.length) continue;
      byDay.set(day.day, [...(byDay.get(day.day) ?? []), ...skipLines(day.skipped, intake.name)]);
      counts.set(day.day, (counts.get(day.day) ?? 0) + day.skipped.length);
    }
  }
  return [...byDay]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([day, lines]) => ({
      at: middayOf(day),
      value: heightOf(day),
      day,
      title: skipTitle(counts.get(day) ?? 1),
      lines,
    }));
}
