/**
 * A reader that jumps by itself (find next, go to page, a thumbnail, a restored position) asks the
 * app shell to keep the reader controls visible: the shell hides them when the *user* scrolls down,
 * and a programmatic jump is not the user reading on.
 */
export const READER_CHROME_HOLD_EVENT = 'minimed:reader-chrome-hold';

export function holdReaderChrome(durationMs = 700): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(READER_CHROME_HOLD_EVENT, { detail: durationMs }));
}

/** The longest one hold keeps the controls up. */
export const READER_CHROME_HOLD_MAX_MS = 3000;

/**
 * When the controls may hide again after a hold of `durationMs` asked for at `now`. A hold extends a
 * running one but never cuts it short: a restored reading position holds them for its whole jump,
 * and the reader's «show the controls now» (`holdReaderChrome(0)` for a new text, 5 ms later) had
 * ended that hold, so the jump's own scroll hid them and moved the reading line up by their height
 * after the place had been restored (57 px on a desktop, E2E-MAIN 2026-11-09).
 */
export function extendReaderChromeHold(holdUntil: number, now: number, durationMs: number): number {
  return Math.max(holdUntil, now + Math.min(Math.max(durationMs, 0), READER_CHROME_HOLD_MAX_MS));
}
