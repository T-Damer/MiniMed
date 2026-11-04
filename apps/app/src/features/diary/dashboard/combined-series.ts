/**
 * What the combined chart can show, as data (DIARY-CHARTS): every indicator, questionnaire total
 * and medicine of the patient over the whole diary, each with a stable key and colour, and the
 * view of a period with the doctor's choice applied. The share of the plan is a line; each medicine
 * is a track of intake marks under the lines, a missed dose a red cross on its track (DIARY23).
 */
import type { ChartMark } from '@/features/diary/dashboard/chart-marks';
import type { ChartSpan } from '@/features/diary/dashboard/chart-period';
import { movingAverage } from '@/features/diary/dashboard/chart-settings';
import {
  chartSeries,
  DIARY_CHARTS,
  skipLines,
  skipMarks,
  skipTitle,
} from '@/features/diary/dashboard/diary-charts';
import type { QuestionnaireSeries, SeriesPoint } from '@/features/diary/dashboard/diary-insights';
import type { IntakeDay, MedicineIntake } from '@/features/diary/dashboard/diary-intake';
import { dayKey } from '@/features/diary/diary-care';
import type { DiaryEntry } from '@/features/diary/diary-model';
import { crossesLimit } from '@/state/assessment-limits';

/**
 * Distinct line colours, readable on the light paper and the dark desk alike; a chart of many
 * lines cannot lean on the few theme accents.
 */
export const PALETTE = [
  '#3c78a0',
  '#d0812e',
  '#b8504a',
  '#4f9a6c',
  '#8a6bb8',
  '#2fa3a3',
  '#c2648f',
  '#8c8a2e',
  '#a3764d',
  '#5e70b0',
] as const;

/** The tracks' colours: darker than the lines' so a square never reads as a line, and no red
 * (the crosses are red). */
const TRACK_PALETTE = ['#34557a', '#7a5a2e', '#5f4785', '#2f6a55', '#6d6b2a', '#7a3f5f'] as const;

/** «Пульс, уд/мин» → «пульс, уд/мин»; «SpO₂, %» keeps its capitals. */
function lowerFirst(label: string): string {
  return /^\p{Lu}\p{Ll}+(?![\p{L}\d₀-₉])/u.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : label;
}

export type CombinedGroup = 'vitals' | 'quiz' | 'medicine';

export const COMBINED_GROUP_LABEL: Record<CombinedGroup, string> = {
  vitals: 'Показатели',
  quiz: 'Опросники',
  medicine: 'Лекарства',
};

/** One line the chart can draw, over the whole diary. */
export interface CombinedSource {
  readonly key: string;
  readonly group: CombinedGroup;
  readonly label: string;
  readonly unit?: string;
  readonly color: string;
  readonly points: readonly SeriesPoint[];
  /** A fixed scale (0–10, 0–100 %, a questionnaire's maximum); the values seen otherwise. */
  readonly fixed?: { readonly low: number; readonly high: number };
  /** The value is past the doctor's red line. */
  readonly alarm?: (value: number) => boolean;
}

/** One medicine's intake marks: a square a day it was taken, a cross a day a dose was missed. */
export interface MedicineTrack {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly color: string;
  readonly days: readonly IntakeDay[];
}

/** One line of the drawn chart: on its own range, told in its own units. */
export interface CombinedSeries {
  readonly key: string;
  readonly label: string;
  readonly unit?: string;
  readonly color: string;
  readonly points: readonly SeriesPoint[];
  /** The 7-day average over the period, counted from the days before it too. */
  readonly average: readonly SeriesPoint[];
  /** The value drawn at the bottom and at the top of the chart. */
  readonly low: number;
  readonly high: number;
}

export const SHARE_KEY = 'intake-share';

/** A sensible range for a value without a fixed scale: the values seen, a little padded. */
export function rangeOf(points: readonly SeriesPoint[]): { low: number; high: number } {
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!Number.isFinite(low)) return { low: 0, high: 1 };
  const pad = high === low ? Math.max(1, Math.abs(high) * 0.1) : (high - low) * 0.15;
  return { low: low - pad, high: high + pad };
}

/** A day's share of the plan taken, over every medicine with a plan that day. */
function planShare(intakes: readonly MedicineIntake[]): Map<string, number> {
  const days = new Map<string, { taken: number; prescribed: number }>();
  for (const one of intakes.flatMap((medicine) => medicine.days)) {
    // A medicine taken when needed has no plan to share (its doses once pushed a day past
    // 100 %, off the chart, DIARY23).
    if (one.prescribed === undefined) continue;
    const total = days.get(one.day) ?? { taken: 0, prescribed: 0 };
    days.set(one.day, {
      taken: total.taken + Math.min(one.taken, one.prescribed),
      prescribed: total.prescribed + one.prescribed,
    });
  }
  const share = new Map<string, number>();
  for (const [day, total] of days) {
    if (total.prescribed > 0) share.set(day, Math.round((total.taken / total.prescribed) * 100));
  }
  return share;
}

/** Everything the patient's diary can chart, in the order the chooser lists it. */
export function combinedSources(input: {
  readonly intakes: readonly MedicineIntake[];
  readonly entries: readonly DiaryEntry[];
  readonly quizzes: readonly QuestionnaireSeries[];
  readonly today: string;
}): { sources: CombinedSource[]; tracks: MedicineTrack[] } {
  const sources: Omit<CombinedSource, 'color'>[] = [];
  for (const chart of DIARY_CHARTS) {
    const name = chart.title.split(/[,(]/u)[0]?.trim() ?? chart.title;
    for (const one of chartSeries(chart, input.entries)) {
      if (!one.points.length) continue;
      const limit = chart.limits?.find((candidate) => candidate.id === one.field);
      const fixed =
        one.axis === 'right'
          ? chart.rightMin !== undefined && chart.rightMax !== undefined
            ? { low: chart.rightMin, high: chart.rightMax }
            : undefined
          : chart.min !== undefined && chart.max !== undefined
            ? { low: chart.min, high: chart.max }
            : undefined;
      sources.push({
        key: `chart:${chart.id}:${one.field}${one.check ? `:${one.check}` : ''}`,
        group: 'vitals',
        label: chart.series.length > 1 ? `${name}: ${lowerFirst(one.label)}` : name,
        ...(limit?.unit ? { unit: limit.unit } : {}),
        points: one.points,
        ...(fixed ? { fixed } : {}),
        ...(limit ? { alarm: (value: number) => crossesLimit(limit.id, value) } : {}),
      });
    }
  }
  for (const quiz of input.quizzes) {
    if (quiz.profile || !quiz.points.length) continue;
    const points = quiz.points.map((point) => ({ at: point.at, value: point.total }));
    sources.push({
      key: `quiz:${quiz.checkpointId}`,
      group: 'quiz',
      label: quiz.title,
      unit: 'баллов',
      points,
      fixed: {
        low: 0,
        high: quiz.points[0]?.max ?? Math.max(...points.map((point) => point.value)),
      },
      alarm: (value) => crossesLimit(quiz.limitId, value, quiz.preset),
    });
  }
  const share = [...planShare(input.intakes)]
    // Today is not over: its untaken doses are not missed yet.
    .filter(([day]) => day < input.today)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([day, value]) => ({ at: new Date(`${day}T12:00:00`).toISOString(), value }));
  if (share.length) {
    sources.push({
      key: SHARE_KEY,
      group: 'medicine',
      label: 'Приём лекарств',
      unit: '% плана',
      points: share,
      fixed: { low: 0, high: 100 },
    });
  }
  const colored = sources.map((source, index) => ({
    ...source,
    color: PALETTE[index % PALETTE.length] ?? PALETTE[0],
  }));
  const tracks = input.intakes
    .filter((intake) => intake.days.some((day) => day.taken > 0 || day.skipped?.length))
    .map((intake, index) => ({
      key: `med:${intake.itemId}`,
      label: intake.name,
      unit: intake.unit,
      color: TRACK_PALETTE[index % TRACK_PALETTE.length] ?? TRACK_PALETTE[0],
      days: intake.days,
    }));
  return { sources: colored, tracks };
}

/** What a period of the chart draws: the shown lines and tracks, red days and crosses. */
export interface CombinedView {
  readonly series: readonly CombinedSeries[];
  readonly tracks: readonly MedicineTrack[];
  readonly alarms: readonly number[];
  readonly marks: readonly ChartMark[];
  /** The crosses sit on the tracks (y = the track's row) or on the intake line (0–100). */
  readonly marksOn: 'tracks' | 'share';
}

/** The sources and tracks of `span` the doctor did not turn off. */
export function combinedView(input: {
  readonly sources: readonly CombinedSource[];
  readonly tracks: readonly MedicineTrack[];
  readonly intakes: readonly MedicineIntake[];
  readonly hidden: readonly string[];
  readonly span: ChartSpan;
  readonly alarms: boolean;
}): CombinedView {
  const hidden = new Set(input.hidden);
  const inSpan = (at: string): boolean => {
    const day = dayKey(at);
    return day >= input.span.from && day <= input.span.to;
  };
  const series: CombinedSeries[] = [];
  const alarms: number[] = [];
  for (const source of input.sources) {
    if (hidden.has(source.key)) continue;
    const points = source.points.filter((point) => inSpan(point.at));
    if (!points.length) continue;
    series.push({
      key: source.key,
      label: source.label,
      ...(source.unit ? { unit: source.unit } : {}),
      color: source.color,
      points,
      average: movingAverage(source.points).filter((point) => inSpan(point.at)),
      ...(source.fixed ?? rangeOf(points)),
    });
    if (input.alarms && source.alarm) {
      for (const point of points) if (source.alarm(point.value)) alarms.push(Date.parse(point.at));
    }
  }
  const tracks = input.tracks
    .filter((track) => !hidden.has(track.key))
    .map((track) => ({
      ...track,
      days: track.days.filter((day) => day.day >= input.span.from && day.day <= input.span.to),
    }))
    .filter((track) => track.days.some((day) => day.taken > 0 || day.skipped?.length));
  if (tracks.length) {
    const marks = tracks.flatMap((track, row) =>
      track.days.flatMap((day) =>
        day.skipped?.length
          ? [
              {
                at: new Date(`${day.day}T12:00:00`).toISOString(),
                value: row,
                day: day.day,
                title: `${track.label}: ${skipTitle(day.skipped.length).toLowerCase()}`,
                lines: skipLines(day.skipped),
              },
            ]
          : [],
      ),
    );
    return { series, tracks, alarms, marks, marksOn: 'tracks' };
  }
  const share = series.find((one) => one.key === SHARE_KEY);
  if (!share) return { series, tracks, alarms, marks: [], marksOn: 'share' };
  // No tracks: a cross on the intake line where the patient marked a dose as skipped; today's
  // (no point yet) sits at the day's share so far.
  const shares = planShare(input.intakes);
  const marks = skipMarks(
    input.intakes.map((intake) => ({
      ...intake,
      days: intake.days.filter((day) => day.day >= input.span.from && day.day <= input.span.to),
    })),
    (day) => shares.get(day) ?? 0,
  );
  return { series, tracks, alarms, marks, marksOn: 'share' };
}

/** How a medicine's day is drawn on its track. */
export type TrackMark = 'taken' | 'partial' | 'none';

/**
 * A day of a track: taken in full (or any dose of a medicine taken when needed), taken in part,
 * or nothing to draw (no mark — a gap, not a miss; the misses are the crosses).
 */
export function trackMark(day: IntakeDay): TrackMark {
  if (day.taken <= 0) return 'none';
  if (day.prescribed === undefined || day.taken >= day.prescribed) return 'taken';
  return 'partial';
}
