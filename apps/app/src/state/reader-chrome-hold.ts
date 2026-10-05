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
