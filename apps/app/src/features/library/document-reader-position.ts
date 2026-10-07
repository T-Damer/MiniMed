/**
 * The position counter of a reflowed reader («12 / 48»).
 *
 * A reflowed document has no pages: its height changes with the text size, the window and the
 * sections that are mounted so far. A "page" is therefore one entry of the contents list: the
 * sections the outline numbers «01», «02», … The count is stable (the sections are known before
 * they are rendered), it matches what the outline shows, and every number can be reached with the
 * same jump the outline uses. A document with a single entry has no counter.
 */
export interface ReaderPosition {
  /** One-based number of the section the reader is in. */
  readonly current: number;
  readonly total: number;
}

/** Fewer than two entries leave nothing to count or jump to. */
export const MIN_POSITION_TOTAL = 2;

/** The reader's place: the active section's number, or the first one before any is active. */
export function readerPosition(
  anchors: readonly string[],
  activeAnchor: string,
): ReaderPosition | null {
  if (anchors.length < MIN_POSITION_TOTAL) return null;
  const index = activeAnchor ? anchors.indexOf(activeAnchor) : -1;
  return { current: index >= 0 ? index + 1 : 1, total: anchors.length };
}

export function readerPositionLabel(position: ReaderPosition): string {
  return `${String(position.current)} / ${String(position.total)}`;
}

export function readerPositionAriaLabel(position: ReaderPosition): string {
  return `Раздел ${String(position.current)} из ${String(position.total)}. Перейти к разделу`;
}

/**
 * The number a person typed into the jump field. Digits only; a number beyond the ends is taken to
 * the nearest end rather than rejected, because «999» in a 48-section document means «the last».
 */
export function parseReaderPage(input: string, total: number): number | null {
  const text = input.trim();
  if (!/^\d{1,6}$/u.test(text) || total < 1) return null;
  return Math.min(total, Math.max(1, Number.parseInt(text, 10)));
}

export function readerPositionAnchor(anchors: readonly string[], page: number): string | undefined {
  return anchors[page - 1];
}
