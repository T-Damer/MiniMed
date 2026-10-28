/**
 * «Красная линия»: the level above (or, for saturation, below) which a value on a chart is a reason
 * to worry (owner 2026-10-28). One setting per device for assessments and vital signs; charts draw
 * it as a dashed red line and the heatmap marks the days that cross it.
 *
 * Presets: a questionnaire's line comes from its own schema (the first score band that calls for
 * moderate attention or more — PHQ-9 10, Zung SDS 48); measurements use the usual clinical cut-offs
 * below. The doctor can set their own level («Порог тревоги»), or hide the line with `null`.
 */
import { createSignal } from 'solid-js';

import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

const STORAGE_KEY = 'minimed.assessment-limits.v1';

export interface AssessmentLimit {
  readonly value: number;
  /** `below`: worrying under the level (saturation); `above` otherwise. */
  readonly direction: 'above' | 'below';
}

/**
 * Measurements of the care diary: office hypertension from 140/90 (ESH 2023), tachycardia over
 * 100/min at rest, SpO₂ 94 % and lower, 0–10 self-ratings of 3 and lower.
 */
export const MEASUREMENT_LIMITS: Readonly<Record<string, AssessmentLimit>> = {
  systolic: { value: 140, direction: 'above' },
  diastolic: { value: 90, direction: 'above' },
  pulse: { value: 100, direction: 'above' },
  spo2: { value: 94, direction: 'below' },
  wellbeing: { value: 3, direction: 'below' },
  mood: { value: 3, direction: 'below' },
};

export const MEASUREMENT_LIMIT_LABEL: Readonly<Record<string, string>> = {
  systolic: 'Давление верхнее',
  diastolic: 'Давление нижнее',
  pulse: 'Пульс',
  spo2: 'Сатурация',
  wellbeing: 'Самочувствие',
  mood: 'Настроение',
};

const WORRYING = new Set(['moderate', 'high', 'urgent']);

/**
 * The red line a questionnaire's schema declares: on the track of its main scale, the first band
 * that calls for moderate attention or more. Bands ascend; when only the lowest ones worry (a scale
 * where less is worse), the line sits at the top of the last worrying band and points down.
 */
export function scoreScaleLimit(
  definition: Pick<AssessmentDefinition, 'scales' | 'scoreScales'>,
): AssessmentLimit | undefined {
  const main = definition.scales[0]?.id;
  const track =
    definition.scoreScales?.find((scale) => scale.valueId === main) ?? definition.scoreScales?.[0];
  const bands = track?.bands ?? [];
  const first = bands.findIndex((band) => WORRYING.has(band.attentionLevel ?? 'none'));
  const band = bands[first];
  if (!track || !band) return undefined;
  if (first > 0) return { value: band.from, direction: 'above' };
  const calm = bands.findIndex((candidate) => !WORRYING.has(candidate.attentionLevel ?? 'none'));
  const next = bands[calm];
  if (!next) return undefined;
  return { value: next.from - (track.step ?? 1), direction: 'below' };
}

type Overrides = Readonly<Record<string, number | null>>;

// Bumped on every change so charts that read a limit redraw.
const [version, setVersion] = createSignal(0);

function readOverrides(): Overrides {
  void version();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) => value === null || (typeof value === 'number' && Number.isFinite(value)),
      ),
    ) as Overrides;
  } catch (cause) {
    console.warn('Пороги графиков не прочитаны', cause);
    return {};
  }
}

/** The preset of a measurement, or the one passed for a questionnaire (`scoreScaleLimit`). */
export function presetLimit(id: string, preset?: AssessmentLimit): AssessmentLimit | undefined {
  return preset ?? MEASUREMENT_LIMITS[id];
}

/** Whether the doctor changed this line (own level or hidden). */
export function isOwnLimit(id: string): boolean {
  return readOverrides()[id] !== undefined;
}

/** The red line in force, or undefined when there is none or the doctor hid it. Reactive. */
export function assessmentLimit(id: string, preset?: AssessmentLimit): AssessmentLimit | undefined {
  const base = presetLimit(id, preset);
  const override = readOverrides()[id];
  if (override === null) return undefined;
  if (override !== undefined) return { value: override, direction: base?.direction ?? 'above' };
  return base;
}

/** Sets (number) or hides (null) a red line; `undefined` returns to the preset. */
export function setAssessmentLimit(id: string, value: number | null | undefined): void {
  const next: Record<string, number | null> = { ...readOverrides() };
  if (value === undefined) delete next[id];
  else next[id] = value;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  setVersion(version() + 1);
}

/** Whether a value crosses its red line. */
export function crossesLimit(id: string, value: number, preset?: AssessmentLimit): boolean {
  const limit = assessmentLimit(id, preset);
  if (!limit) return false;
  return limit.direction === 'above' ? value >= limit.value : value <= limit.value;
}
