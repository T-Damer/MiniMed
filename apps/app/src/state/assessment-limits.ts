/**
 * «Красная линия»: the level above (or, for saturation, below) which a value on a chart is a reason
 * to worry (owner 2026-10-28). One setting per device for assessments and vital signs; charts draw
 * it as a dashed red line and the heatmap marks the days that cross it.
 *
 * Presets: a questionnaire's line comes from its own schema (the first score band that calls for
 * moderate attention or more — PHQ-9 10, Zung SDS 48); measurements use the usual clinical cut-offs
 * below. For any value the doctor can set their own lines «выше» and «ниже» («Порог тревоги») or
 * hide a preset one.
 */
import { createSignal } from 'solid-js';

import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

const STORAGE_KEY = 'minimed.assessment-limits.v2';

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
  weight: 'Вес',
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

/** Both red lines of one value: worrying from `above` up, and from `below` down. */
export interface AssessmentBounds {
  readonly above?: number;
  readonly below?: number;
}

export type LimitSide = keyof AssessmentBounds;

/** A side the doctor set (number), hid (`null`) or left to the preset (absent). */
type Override = { readonly [side in LimitSide]?: number | null };
type Overrides = Readonly<Record<string, Override>>;

// Bumped on every change so charts that read a limit redraw.
const [version, setVersion] = createSignal(0);

function side(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOverrides(): Overrides {
  void version();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, Override> = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const above = side((entry as Record<string, unknown>)['above']);
      const below = side((entry as Record<string, unknown>)['below']);
      result[id] = {
        ...(above === undefined ? {} : { above }),
        ...(below === undefined ? {} : { below }),
      };
    }
    return result;
  } catch (cause) {
    console.warn('Пороги графиков не прочитаны', cause);
    return {};
  }
}

function writeOverrides(next: Overrides): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  setVersion(version() + 1);
}

/** The preset lines: a questionnaire's from its schema, a measurement's cut-off, else none. */
export function presetBounds(id: string, preset?: AssessmentLimit): AssessmentBounds {
  const limit = preset ?? MEASUREMENT_LIMITS[id];
  return limit ? { [limit.direction]: limit.value } : {};
}

/** Whether the doctor changed either line of this value. */
export function isOwnLimit(id: string): boolean {
  const own = readOverrides()[id];
  return Boolean(own && (own.above !== undefined || own.below !== undefined));
}

/** The red lines in force: the preset with the doctor's own levels over it. Reactive. */
export function assessmentBounds(id: string, preset?: AssessmentLimit): AssessmentBounds {
  const base = presetBounds(id, preset);
  const own = readOverrides()[id] ?? {};
  const pick = (which: LimitSide): number | undefined => {
    const value = own[which];
    return value === null ? undefined : (value ?? base[which]);
  };
  const above = pick('above');
  const below = pick('below');
  return {
    ...(above === undefined ? {} : { above }),
    ...(below === undefined ? {} : { below }),
  };
}

/** Sets (number) or hides (null) one line; `undefined` returns that line to the preset. */
export function setAssessmentBound(
  id: string,
  which: LimitSide,
  value: number | null | undefined,
): void {
  const all: Record<string, Override> = { ...readOverrides() };
  const { [which]: _old, ...rest } = all[id] ?? {};
  const next: Override = value === undefined ? rest : { ...rest, [which]: value };
  if (next.above === undefined && next.below === undefined) delete all[id];
  else all[id] = next;
  writeOverrides(all);
}

/** Both lines of this value back to their presets. */
export function resetAssessmentLimit(id: string): void {
  const { [id]: _old, ...rest } = readOverrides();
  writeOverrides(rest);
}

/** Whether a value crosses either red line. */
export function crossesLimit(id: string, value: number, preset?: AssessmentLimit): boolean {
  const bounds = assessmentBounds(id, preset);
  return (
    (bounds.above !== undefined && value >= bounds.above) ||
    (bounds.below !== undefined && value <= bounds.below)
  );
}
