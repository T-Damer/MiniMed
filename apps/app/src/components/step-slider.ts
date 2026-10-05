/** Pure index helpers for `StepSlider` (a native range over option indices). */

/** Index of `value` in `values`, or 0 when it is not an option. */
export function stepIndexOf(values: readonly string[], value: string): number {
  const index = values.indexOf(value);
  return index < 0 ? 0 : index;
}

/** Clamps a raw range value to a valid option index (NaN and out-of-range safe). */
export function stepIndexFromRange(raw: string, count: number): number {
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, parsed));
}

/** Position of option `index` along the track as a 0..1 fraction (one option sits at 0). */
export function stepFraction(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(1, Math.max(0, index / (count - 1)));
}

/** Position of `value` along `min..max` as a 0..1 fraction (an empty range sits at 0). */
export function rangeFraction(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
