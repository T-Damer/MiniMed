/**
 * «Красная линия»: per-device levels above (or, for saturation, below) which a value on a chart
 * is a reason to worry (owner 2026-10-28). One global setting for assessments and vital signs;
 * charts draw it as a dashed red line. Defaults follow the usual clinical cut-offs; the doctor can
 * change them, and a level set to `null` hides the line.
 */
const STORAGE_KEY = 'minimed.assessment-limits.v1';

export interface AssessmentLimit {
  readonly value: number;
  /** `below`: worrying under the level (saturation); `above` otherwise. */
  readonly direction: 'above' | 'below';
}

export const DEFAULT_ASSESSMENT_LIMITS: Readonly<Record<string, AssessmentLimit>> = {
  systolic: { value: 140, direction: 'above' },
  diastolic: { value: 90, direction: 'above' },
  pulse: { value: 100, direction: 'above' },
  spo2: { value: 94, direction: 'below' },
  wellbeing: { value: 3, direction: 'below' },
  mood: { value: 3, direction: 'below' },
  'phq-9': { value: 10, direction: 'above' },
  'gad-7': { value: 10, direction: 'above' },
};

export const ASSESSMENT_LIMIT_LABEL: Readonly<Record<string, string>> = {
  systolic: 'Давление верхнее',
  diastolic: 'Давление нижнее',
  pulse: 'Пульс',
  spo2: 'Сатурация',
  wellbeing: 'Самочувствие',
  mood: 'Настроение',
  'phq-9': 'PHQ-9',
  'gad-7': 'GAD-7',
};

type Overrides = Readonly<Record<string, number | null>>;

function readOverrides(): Overrides {
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

/** The red line of one assessment or measurement, or undefined when there is none. */
export function assessmentLimit(id: string): AssessmentLimit | undefined {
  const base = DEFAULT_ASSESSMENT_LIMITS[id];
  const override = readOverrides()[id];
  if (override === null) return undefined;
  if (override !== undefined) return { value: override, direction: base?.direction ?? 'above' };
  return base;
}

/** Sets (number) or hides (null) a red line; `undefined` returns to the default. */
export function setAssessmentLimit(id: string, value: number | null | undefined): void {
  const next: Record<string, number | null> = { ...readOverrides() };
  if (value === undefined) delete next[id];
  else next[id] = value;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Whether a value crosses its red line. */
export function crossesLimit(id: string, value: number): boolean {
  const limit = assessmentLimit(id);
  if (!limit) return false;
  return limit.direction === 'above' ? value >= limit.value : value <= limit.value;
}
