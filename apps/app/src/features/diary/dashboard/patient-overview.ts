/**
 * What changed for one patient this week, as a short list of signals for the top of the doctor's
 * patient page (owner 2026-11-03: the charts alone «are only part» of the picture, and counters
 * such as «119 записей» say nothing). Every signal is derived from declared data — the chart
 * declarations (`DIARY_CHARTS`), the questionnaire schemas, the plan — so a new chart or
 * questionnaire joins the list by itself; each opens its chart on the charts page.
 */
import type { AppGlyphName } from '@/components/AppGlyph';
import { pluralize } from '@/diary/diary-format';
import {
  chartSeries,
  DIARY_CHARTS,
  type DiaryChart,
} from '@/features/diary/dashboard/diary-charts';
import {
  adherence,
  type MedicineAdherence,
  medicineAdherence,
  missReasonsText,
  type QuestionnaireSeries,
  type SeriesPoint,
} from '@/features/diary/dashboard/diary-insights';
import type { DiaryEntry, DiaryInvitation } from '@/features/diary/diary-model';
import { crossesLimit } from '@/state/assessment-limits';

export type SignalTone = 'default' | 'good' | 'warn' | 'danger';

/** Where a signal leads: a chart on the charts page, or the pairing sheet. */
export type SignalTarget = { readonly chart: string } | { readonly pair: true };

export interface OverviewSignal {
  readonly id: string;
  readonly glyph: AppGlyphName;
  readonly title: string;
  /** The latest value, in the chart's own words («Верхнее 139 · Нижнее 72»). */
  readonly value?: string;
  /** Why it matters: over the red line, missed doses, the band. */
  readonly detail?: string;
  readonly tone: SignalTone;
  /** Change of the week's average against the week before, or of the last result. */
  readonly trend?: { readonly direction: 'up' | 'down'; readonly text: string };
  readonly target: SignalTarget;
}

const DAY = 86_400_000;
const WEEK = 7;
/** Days without a record before the silence itself becomes a signal. */
const QUIET_DAYS = 2;
/** The id the charts page gives medicine intake. */
export const INTAKE_CHART_ID = 'intake';

const number = (value: number): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

function between(entries: readonly DiaryEntry[], from: number, to: number): DiaryEntry[] {
  return entries.filter((entry) => {
    const at = Date.parse(entry.at);
    return at >= from && at < to;
  });
}

function mean(points: readonly SeriesPoint[]): number | undefined {
  return points.length
    ? points.reduce((sum, point) => sum + point.value, 0) / points.length
    : undefined;
}

function trendOf(now: number | undefined, before: number | undefined): OverviewSignal['trend'] {
  if (now === undefined || before === undefined) return undefined;
  const delta = now - before;
  // Below a tenth of a point the change is rounding, not a trend.
  if (Math.abs(delta) < 0.1) return undefined;
  return { direction: delta > 0 ? 'up' : 'down', text: number(Math.abs(delta)) };
}

/** «Самочувствие (0–10)» → «Самочувствие», «Давление, мм рт. ст.» stays: the unit helps there. */
function chartName(chart: DiaryChart): string {
  return chart.title.replace(/\s*\([^)]*\)\s*$/u, '');
}

/** «Пульс, уд/мин» → «Пульс»: a series' short name before its unit. */
function seriesName(label: string): string {
  return label.split(',')[0]?.trim() ?? label;
}

function chartSignal(
  chart: DiaryChart,
  week: readonly DiaryEntry[],
  previous: readonly DiaryEntry[],
): OverviewSignal | undefined {
  const series = chartSeries(chart, week).filter((one) => one.points.length);
  if (!series.length) return undefined;
  const limited = new Set((chart.limits ?? []).map((limit) => limit.id));
  let over = 0;
  let latestOver = false;
  for (const one of series) {
    if (!limited.has(one.field)) continue;
    for (const point of one.points) if (crossesLimit(one.field, point.value)) over += 1;
    const last = one.points.at(-1);
    if (last && crossesLimit(one.field, last.value)) latestOver = true;
  }
  const value = series
    .map((one) => {
      const last = one.points.at(-1)?.value ?? 0;
      return series.length > 1 ? `${seriesName(one.label)} ${number(last)}` : number(last);
    })
    .join(' · ');
  const first = series[0];
  const before = first
    ? chartSeries(chart, previous).find(
        (one) => one.field === first.field && one.check === first.check,
      )
    : undefined;
  const trend = trendOf(mean(first?.points ?? []), mean(before?.points ?? []));
  return {
    id: chart.id,
    glyph: 'chart-line',
    title: chartName(chart),
    value,
    ...(over
      ? { detail: `за порогом ${over} ${pluralize(over, 'раз', 'раза', 'раз')} за неделю` }
      : {}),
    tone: latestOver ? 'danger' : over ? 'warn' : 'default',
    ...(trend ? { trend } : {}),
    target: { chart: chart.id },
  };
}

function questionnaireSignal(series: QuestionnaireSeries): OverviewSignal | undefined {
  const last = series.points.at(-1);
  if (!last) return undefined;
  const previous = series.points.at(-2);
  const alarming =
    last.alerts.length > 0 ||
    (!series.profile && crossesLimit(series.limitId, last.total, series.preset));
  const trend = series.profile ? undefined : trendOf(last.total, previous?.total);
  const when = new Date(last.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return {
    id: series.checkpointId,
    glyph: 'list-checks',
    title: series.title,
    value: series.profile ? last.headline : `${last.total} из ${last.max}`,
    detail: series.profile ? when : `${last.headline} · ${when}`,
    tone: alarming ? 'danger' : 'default',
    ...(trend ? { trend } : {}),
    target: { chart: series.checkpointId },
  };
}

function mergeReasons(medicines: readonly MedicineAdherence[]): MedicineAdherence['reasons'] {
  const total: Partial<Record<keyof MedicineAdherence['reasons'], number>> = {};
  for (const medicine of medicines) {
    for (const [reason, count] of Object.entries(medicine.reasons) as [
      keyof MedicineAdherence['reasons'],
      number,
    ][]) {
      total[reason] = (total[reason] ?? 0) + count;
    }
  }
  return total;
}

function intakeSignal(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[],
  now: Date,
): OverviewSignal | undefined {
  const medicines = medicineAdherence(invitation, entries, WEEK, now).filter(
    (medicine) => medicine.planned > 0,
  );
  if (!medicines.length) return undefined;
  const week = adherence(invitation, entries, WEEK, now);
  const share = week.share;
  const missed = medicines.filter((medicine) => medicine.taken < medicine.planned);
  const missedCount = missed.reduce(
    (sum, medicine) => sum + (medicine.planned - medicine.taken),
    0,
  );
  return {
    id: INTAKE_CHART_ID,
    glyph: 'pill',
    title: 'Приём лекарств',
    ...(share === undefined ? {} : { value: `${Math.round(share * 100)} % плана` }),
    ...(missedCount
      ? {
          detail: [
            `не отмечено ${missedCount} ${pluralize(missedCount, 'приём', 'приёма', 'приёмов')}: ${missed
              .map((medicine) => medicine.name)
              .join(', ')}`,
            // Why, as the patient said (DIARY22).
            missReasonsText(mergeReasons(medicines)),
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : { detail: 'всё по плану' }),
    tone:
      share === undefined ? 'default' : share >= 0.8 ? 'good' : share >= 0.5 ? 'warn' : 'danger',
    target: { chart: INTAKE_CHART_ID },
  };
}

const TONE_ORDER: Readonly<Record<SignalTone, number>> = {
  danger: 0,
  warn: 1,
  good: 2,
  default: 2,
};

/**
 * The week's signals, the worrying first: missed silence and an unpaired phone, values over the
 * doctor's red lines, questionnaires with alerts, then the rest in the order the charts are
 * declared.
 */
export function overviewSignals(input: {
  readonly invitation: DiaryInvitation;
  readonly entries: readonly DiaryEntry[];
  readonly questionnaires: readonly QuestionnaireSeries[];
  /** Phones connected to the diary. */
  readonly devices: number;
  readonly now?: Date;
}): OverviewSignal[] {
  const now = input.now ?? new Date();
  const end = now.getTime() + 1;
  const week = between(input.entries, end - WEEK * DAY, end);
  const previous = between(input.entries, end - 2 * WEEK * DAY, end - WEEK * DAY);
  const signals: OverviewSignal[] = [];

  if (input.devices === 0) {
    signals.push({
      id: 'pair',
      glyph: 'device-mobile',
      title: 'Девайс не подключён',
      detail: 'покажите пациенту QR-код',
      tone: 'warn',
      target: { pair: true },
    });
  }
  const lastAt = input.entries.reduce(
    (latest, entry) => Math.max(latest, Date.parse(entry.at)),
    Number.NEGATIVE_INFINITY,
  );
  const quiet = Number.isFinite(lastAt) ? Math.floor((now.getTime() - lastAt) / DAY) : undefined;
  if (quiet !== undefined && quiet >= QUIET_DAYS) {
    signals.push({
      id: 'quiet',
      glyph: 'clock',
      title: `Нет записей ${quiet} ${pluralize(quiet, 'день', 'дня', 'дней')}`,
      detail: `последняя ${new Date(lastAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`,
      tone: quiet >= 2 * QUIET_DAYS ? 'danger' : 'warn',
      target: { chart: INTAKE_CHART_ID },
    });
  }
  const intake = intakeSignal(input.invitation, input.entries, now);
  if (intake) signals.push(intake);
  for (const chart of DIARY_CHARTS) {
    const signal = chartSignal(chart, week, previous);
    if (signal) signals.push(signal);
  }
  for (const series of input.questionnaires) {
    const signal = questionnaireSignal(series);
    if (signal) signals.push(signal);
  }
  return signals
    .map((signal, index) => ({ signal, index }))
    .toSorted(
      (left, right) =>
        TONE_ORDER[left.signal.tone] - TONE_ORDER[right.signal.tone] || left.index - right.index,
    )
    .map(({ signal }) => signal);
}

/** One line for the folded card: how many rows need a look, or that the week was calm. */
export function overviewSummary(signals: readonly OverviewSignal[]): string {
  const danger = signals.filter((signal) => signal.tone === 'danger').length;
  const warn = signals.filter((signal) => signal.tone === 'warn').length;
  const parts = [
    danger ? `${danger} ${pluralize(danger, 'тревожный', 'тревожных', 'тревожных')}` : '',
    warn ? `${warn} ${pluralize(warn, 'требует', 'требуют', 'требуют')} внимания` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'неделя спокойная';
}
