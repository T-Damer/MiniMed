/**
 * The period the doctor's charts show (DIARY-CHARTS, owner 2026-11-04: «a week, two weeks, a month,
 * any dates, arrows to step»): whole local days from `from` to `to`, never past today. A preset is
 * the last N days; the arrows move the same length back or forward; the brush and the date fields
 * set any span.
 */
import { addDays, dayKey, dayStart } from '@/features/diary/diary-care';

/** Inclusive local days `YYYY-MM-DD`. */
export interface ChartSpan {
  readonly from: string;
  readonly to: string;
}

export type ChartPreset = '7' | '14' | '30' | '90';

export const CHART_PRESETS: readonly { readonly value: ChartPreset; readonly label: string }[] = [
  { value: '7', label: 'Неделя' },
  { value: '14', label: '2 нед.' },
  { value: '30', label: 'Месяц' },
  { value: '90', label: '3 мес.' },
];

export function isChartPreset(value: unknown): value is ChartPreset {
  return CHART_PRESETS.some((preset) => preset.value === value);
}

/** The last `preset` days up to `today`. */
export function presetSpan(preset: ChartPreset, today: string): ChartSpan {
  return { from: addDays(today, 1 - Number(preset)), to: today };
}

/** Days in the span, both ends counted. */
export function spanDays(span: ChartSpan): number {
  return Math.round((dayStart(span.to).getTime() - dayStart(span.from).getTime()) / 86_400_000) + 1;
}

/** The preset the span is, when it is the last N days up to today. */
export function spanPreset(span: ChartSpan, today: string): ChartPreset | undefined {
  if (span.to !== today) return undefined;
  const days = String(spanDays(span));
  return isChartPreset(days) ? days : undefined;
}

/**
 * A span with its ends in order, at least one day long, inside `[first, today]` when it can be:
 * a span reaching past today is moved back whole, one starting before `first` is cut there.
 */
export function clampSpan(span: ChartSpan, today: string, first?: string): ChartSpan {
  let from = span.from <= span.to ? span.from : span.to;
  let to = span.from <= span.to ? span.to : span.from;
  if (to > today) {
    from = addDays(from, -(spanDays({ from: today, to }) - 1));
    to = today;
  }
  if (first && from < first && to >= first) from = first;
  return { from, to };
}

/**
 * The same length one step back (`-1`) or forward (`1`); forward stops at today, back keeps the
 * whole length even before the diary began (those days are simply empty).
 */
export function shiftSpan(span: ChartSpan, direction: -1 | 1, today: string): ChartSpan {
  const length = spanDays(span);
  if (direction > 0) {
    const to = addDays(span.to, length) > today ? today : addDays(span.to, length);
    return { from: addDays(to, 1 - length), to };
  }
  return { from: addDays(span.from, -length), to: addDays(span.from, -1) };
}

/** The span's ends as times for the axis: the first day's midnight, the last day's end or now. */
export function spanTimes(span: ChartSpan, now: Date = new Date()): { from: number; to: number } {
  const end = dayStart(addDays(span.to, 1)).getTime();
  return { from: dayStart(span.from).getTime(), to: Math.min(end, now.getTime()) };
}

/** The span's last moment that counts, for plans and adherence («now» of a past span). */
export function spanNow(span: ChartSpan, now: Date = new Date()): Date {
  return span.to >= dayKey(now) ? now : new Date(dayStart(addDays(span.to, 1)).getTime() - 1);
}

/** «28 окт. – 3 нояб.», with the year when the span is not this year. */
export function spanLabel(span: ChartSpan, today: string): string {
  const year = today.slice(0, 4);
  const one = (day: string): string =>
    dayStart(day).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      ...(day.slice(0, 4) === year ? {} : { year: 'numeric' }),
    });
  return span.from === span.to ? one(span.from) : `${one(span.from)} – ${one(span.to)}`;
}
