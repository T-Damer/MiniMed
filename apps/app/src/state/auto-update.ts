/**
 * New versions arrive by themselves (owner 2026-11-03: «the user just opens the app and gets the
 * new version»): an update found while nobody has touched the page yet is applied at once (a reload
 * at start looks like a slightly longer start); one found later waits until the page is hidden — the
 * app sent to the background, the phone locked — and is applied there, so the next look already
 * shows it. Drafts autosave, so a reload in the background loses nothing.
 */

/** How long after start a reload still reads as part of opening the app. */
export const QUIET_START_MS = 8_000;

const INTERACTIONS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface QuietPage {
  readonly startedAt: number;
  now(): number;
  hidden(): boolean;
  touched(): boolean;
  onHidden(listener: () => void): () => void;
}

let touchedAt: number | undefined;
let listening = false;

function listenForTouches(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const mark = (): void => {
    touchedAt ??= Date.now();
    for (const type of INTERACTIONS) window.removeEventListener(type, mark, true);
  };
  for (const type of INTERACTIONS)
    window.addEventListener(type, mark, { capture: true, passive: true });
}

const startedAt = Date.now();

export function browserQuietPage(): QuietPage {
  listenForTouches();
  return {
    startedAt,
    now: () => Date.now(),
    hidden: () => document.visibilityState === 'hidden',
    touched: () => touchedAt !== undefined,
    onHidden(listener) {
      const handle = (): void => {
        if (document.visibilityState === 'hidden') listener();
      };
      document.addEventListener('visibilitychange', handle);
      return () => document.removeEventListener('visibilitychange', handle);
    },
  };
}

/** Runs `apply` now when the page is untouched at start or hidden, else the next time it hides. */
export function applyWhenQuiet(apply: () => void, page: QuietPage = browserQuietPage()): void {
  const atStart = !page.touched() && page.now() - page.startedAt < QUIET_START_MS;
  if (atStart || page.hidden()) {
    apply();
    return;
  }
  const stop = page.onHidden(() => {
    stop();
    apply();
  });
}
