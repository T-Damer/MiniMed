/**
 * How many sections the reader mounts at a time.
 *
 * A document is rendered in slices so that the first screen appears at once and the rest follows
 * while the person already reads: a slice is measured in characters of text (the same weight the page
 * model uses), not in sections, because one section may be a title line and the next a few hundred
 * paragraphs. The first slice holds about one screen of text, later ones a couple of pages each.
 */

/** About one screen of reading text: what the first slice mounts before the browser paints. */
export const FIRST_SLICE_WEIGHT = 2400;
/** Text of one idle slice after the first: small enough to stay under a frame or two on a phone. */
export const IDLE_SLICE_WEIGHT = 4800;
/** Headings without text weigh next to nothing; the slice still stops after this many sections. */
export const MAX_SECTIONS_PER_SLICE = 8;

/** The section count that reaches `budget` characters from `from` (at least one section more). */
function countThroughWeight(weights: readonly number[], from: number, budget: number): number {
  let count = from;
  let taken = 0;
  while (count < weights.length && count - from < MAX_SECTIONS_PER_SLICE) {
    taken += Math.max(1, weights[count] ?? 0);
    count += 1;
    if (taken >= budget) break;
  }
  return count;
}

/**
 * Sections to mount before the first paint: about a screen of text, and always the section that
 * holds the place the reader opens at (`anchorIndex`, or −1 for the top of the document).
 */
export function firstSliceCount(weights: readonly number[], anchorIndex: number): number {
  if (weights.length === 0) return 0;
  const fromTop = countThroughWeight(weights, 0, FIRST_SLICE_WEIGHT);
  return Math.min(weights.length, Math.max(fromTop, anchorIndex + 1));
}

/** The section count after one more idle slice. */
export function nextSliceCount(weights: readonly number[], mounted: number): number {
  return countThroughWeight(weights, Math.min(mounted, weights.length), IDLE_SLICE_WEIGHT);
}
