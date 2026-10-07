/**
 * Where the highlight popup goes relative to a text selection.
 *
 * With a mouse the popup floats above the selection. On a touch screen the system opens its own
 * selection menu (copy, select all, …) above the selection, so a popup there would sit under it:
 * the popup goes below the selection instead, clear of the drag handles, and docks above the
 * bottom navigation when the selection is too close to the bottom edge for that.
 */

export type HighlightPopupPlacement = 'above' | 'below' | 'dock';

/** Space under a selection the system's drag handles take. */
export const SELECTION_HANDLE_CLEARANCE_PX = 32;
const POPUP_HEIGHT_PX = 56;
/** The bottom navigation and its gap, which a popup below the selection must stay clear of. */
const BOTTOM_NAVIGATION_PX = 80;

export function highlightPopupPlacement(
  selection: { readonly bottom: number },
  viewportHeight: number,
  touch: boolean,
): HighlightPopupPlacement {
  if (!touch) return 'above';
  const roomBelow = viewportHeight - selection.bottom;
  return roomBelow >= SELECTION_HANDLE_CLEARANCE_PX + POPUP_HEIGHT_PX + BOTTOM_NAVIGATION_PX
    ? 'below'
    : 'dock';
}

/** Characters of the highlighted text kept as the quote. */
export const HIGHLIGHT_QUOTE_LIMIT = 400;

/**
 * Whether the saved quote still describes the text at `start..end`. Official documents are drawn
 * from stored text by reading rules that can change between app versions; a highlight whose text
 * moved is hidden rather than painted over other words. Whitespace differences are ignored.
 */
export function highlightQuoteMatches(
  text: string,
  start: number,
  end: number,
  quote: string,
): boolean {
  const saved = normalize(quote);
  if (saved.length === 0) return true;
  const current = normalize(text.slice(start, end));
  // A range up to the limit was saved whole; a longer one only as its first characters.
  return end - start <= HIGHLIGHT_QUOTE_LIMIT ? current === saved : current.startsWith(saved);
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
