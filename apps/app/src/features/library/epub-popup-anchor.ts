/**
 * The highlight popup of a book sits over the text it belongs to. The continuous EPUB view scrolls
 * the page by itself while it renders neighbouring chapters (it keeps the reader's place), so a
 * scroll event alone does not mean the reader moved away: only a scroll the reader started closes
 * the popup; otherwise it follows its text.
 */

/** How long after a wheel, touch move or scroll key a scroll still counts as the reader's own. */
export const USER_SCROLL_WINDOW_MS = 500;

const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

export function isScrollKey(key: string): boolean {
  return SCROLL_KEYS.has(key);
}

export interface UserScrollTracker {
  /** A wheel, touch move or scroll key just happened. */
  mark(now: number): void;
  /** Whether a scroll at `now` follows the reader's own gesture. */
  isUserScroll(now: number): boolean;
}

export function createUserScrollTracker(windowMs = USER_SCROLL_WINDOW_MS): UserScrollTracker {
  let last = Number.NEGATIVE_INFINITY;
  return {
    mark(now) {
      last = now;
    },
    isUserScroll(now) {
      return now - last <= windowMs;
    },
  };
}

export interface PopupPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the popup goes for text at `rect` inside a chapter frame at `frame` (both from
 * `getBoundingClientRect`): above the middle of the text. `null` when the text is gone (an empty
 * rect) or no longer on screen, so the popup closes instead of pointing at nothing.
 */
export function popupPointForText(
  frame: Pick<DOMRect, 'left' | 'top'>,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport: { readonly width: number; readonly height: number },
): PopupPoint | null {
  if (rect.width <= 0 && rect.height <= 0) return null;
  const top = frame.top + rect.top;
  const bottom = top + rect.height;
  if (bottom < 0 || top > viewport.height) return null;
  return { x: frame.left + rect.left + rect.width / 2, y: top };
}
