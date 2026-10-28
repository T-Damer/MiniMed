/**
 * The month calendar's part filter, remembered on this device between visits (owner 2026-10-28).
 * The patient's diary and the doctor's views keep separate choices; the doctor's one applies to
 * every patient, limited to the parts that patient's plan has.
 */
import { type Accessor, createSignal } from 'solid-js';

import { activeHeatParts } from '@/diary/diary-heatmap-range';
import { HEAT_PART_LABEL, type HeatPart } from '@/features/diary/diary-care';

export const PATIENT_HEAT_FILTER_KEY = 'minimed.diary.heatmap-filter.v1';
export const DOCTOR_HEAT_FILTER_KEY = 'minimed.diary.doctor-heatmap-filter.v1';

function isHeatPart(value: unknown): value is HeatPart {
  return typeof value === 'string' && Object.hasOwn(HEAT_PART_LABEL, value);
}

/** The saved parts; empty (everything) when nothing valid was saved. */
export function readHeatFilter(key: string): ReadonlySet<HeatPart> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(isHeatPart) : []);
  } catch (cause) {
    console.warn('Фильтр календаря не прочитан', cause);
    return new Set();
  }
}

export function saveHeatFilter(key: string, include: ReadonlySet<HeatPart>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...include]));
  } catch (cause) {
    // Private mode or full storage: the filter still works for this visit.
    console.warn('Фильтр календаря не сохранён', cause);
  }
}

/**
 * The parts the calendar counts for a plan with `parts`: the saved choice limited to them, or
 * everything (an empty set) when none of the saved parts is in this plan.
 */
export function effectiveHeatParts(
  parts: readonly HeatPart[],
  include: ReadonlySet<HeatPart>,
): ReadonlySet<HeatPart> {
  if (!include.size || !parts.some((part) => include.has(part))) return new Set();
  return new Set(activeHeatParts(parts, include));
}

/** A filter signal that starts from the saved choice and saves every change. */
export function createHeatFilter(
  key: string,
): readonly [Accessor<ReadonlySet<HeatPart>>, (next: ReadonlySet<HeatPart>) => void] {
  const [include, setInclude] = createSignal(readHeatFilter(key));
  return [
    include,
    (next) => {
      setInclude(next);
      saveHeatFilter(key, next);
    },
  ];
}
