/**
 * What the doctor chose to see on the combined chart, per patient, on this device (DIARY-CHARTS,
 * owner 2026-11-04: «the doctor picks what the chart shows to compare a drug's intake with the
 * curves»). The choice keeps the series turned off, so a value the patient starts recording later
 * shows up by itself; and the period length, so the patient opens on the span last looked at.
 */
import { type Accessor, createSignal } from 'solid-js';

import { type ChartPreset, isChartPreset } from '@/features/diary/dashboard/chart-period';
import type { SeriesPoint } from '@/features/diary/dashboard/diary-insights';
import { addDays, dayKey } from '@/features/diary/diary-care';

export const CHART_SETTINGS_KEY = 'minimed.diary.chart-settings.v1';

export interface ChartSettings {
  /** Series keys turned off (`CombinedSource.key`). */
  readonly hidden: readonly string[];
  /** A dashed line at each series' median over the period. */
  readonly median: boolean;
  /** Each series as its 7-day average, the measured line faded behind it. */
  readonly average: boolean;
  /** Days past a red line painted red. */
  readonly alarms: boolean;
  /** The series' names under the chart. */
  readonly legend: boolean;
  readonly preset: ChartPreset;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  hidden: [],
  median: false,
  average: false,
  alarms: true,
  legend: true,
  preset: '30',
};

type Stored = Record<string, ChartSettings>;

function parseSettings(value: unknown): ChartSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_CHART_SETTINGS;
  const raw = value as Record<string, unknown>;
  const flag = (name: keyof ChartSettings): boolean =>
    typeof raw[name] === 'boolean'
      ? (raw[name] as boolean)
      : (DEFAULT_CHART_SETTINGS[name] as boolean);
  return {
    hidden: Array.isArray(raw['hidden'])
      ? raw['hidden'].filter((key): key is string => typeof key === 'string')
      : [],
    median: flag('median'),
    average: flag('average'),
    alarms: flag('alarms'),
    legend: flag('legend'),
    preset: isChartPreset(raw['preset']) ? raw['preset'] : DEFAULT_CHART_SETTINGS.preset,
  };
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(CHART_SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as Stored) : {};
  } catch (cause) {
    console.warn('Настройки графика не прочитаны', cause);
    return {};
  }
}

const scoped = (doctorId: string, patientId: string): string => `${doctorId}:${patientId}`;

export function readChartSettings(doctorId: string, patientId: string): ChartSettings {
  return parseSettings(read()[scoped(doctorId, patientId)]);
}

export function saveChartSettings(
  doctorId: string,
  patientId: string,
  settings: ChartSettings,
): void {
  try {
    const stored = read();
    stored[scoped(doctorId, patientId)] = settings;
    window.localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify(stored));
  } catch (cause) {
    // Private mode or full storage: the choice still holds for this visit.
    console.warn('Настройки графика не сохранены', cause);
  }
}

/** A settings signal that starts from the patient's saved choice and saves every change. */
export function createChartSettings(
  doctorId: string,
  patientId: string,
): readonly [Accessor<ChartSettings>, (change: Partial<ChartSettings>) => void] {
  const [settings, setSettings] = createSignal(readChartSettings(doctorId, patientId));
  return [
    settings,
    (change) => {
      const next = { ...settings(), ...change };
      setSettings(next);
      saveChartSettings(doctorId, patientId, next);
    },
  ];
}

/** `key` shown or hidden, the rest of the choice kept. */
export function toggleHidden(hidden: readonly string[], key: string, show: boolean): string[] {
  const rest = hidden.filter((one) => one !== key);
  return show ? rest : [...rest, key];
}

/** The middle value; undefined for none. */
export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * The trailing average over `days` calendar days, one point at noon of every day that has a value:
 * the mean of every value from `days − 1` days before to that day. A gap in the diary is not
 * filled in.
 */
export function movingAverage(points: readonly SeriesPoint[], days = 7): SeriesPoint[] {
  const byDay = new Map<string, number[]>();
  for (const point of points) {
    const day = dayKey(point.at);
    byDay.set(day, [...(byDay.get(day) ?? []), point.value]);
  }
  return [...byDay.keys()].toSorted().map((day) => {
    const since = addDays(day, 1 - days);
    const values = [...byDay].flatMap(([one, list]) => (one >= since && one <= day ? list : []));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { at: new Date(`${day}T12:00:00`).toISOString(), value: Math.round(mean * 10) / 10 };
  });
}
