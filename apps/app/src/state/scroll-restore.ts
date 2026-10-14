/**
 * Scroll positions per history entry.
 *
 * The page is one document whose content is swapped by the router, so the browser's own scroll
 * restoration (which runs before the router has put the old screen back, against the wrong
 * height) lands in the wrong place or at 0. The app takes it over (`scrollRestoration = 'manual'`):
 *
 * - while the user scrolls, the position is remembered for the entry the page is on;
 * - when the history comes back to an entry (back, forward, a tab step) the position is restored
 *   once the layout has settled: results and documents load late, so the restore keeps putting the
 *   page at the remembered place until it holds there for a while, the user takes over, or time
 *   runs out;
 * - positions also survive a reload (session storage), keyed by the entry id.
 *
 * Document readers keep their own (section anchor plus offset) position and are left alone.
 */
import { isDocumentReadRoute } from '@/state/document-route';
import { currentHistoryEntry, onHistoryArrival } from '@/state/history-entries';

const STORAGE_KEY = 'minimed:entry-scroll';
const MAX_ENTRIES = 80;
const RESTORE_MAX_MS = 2500;
const SETTLED_FRAMES = 10;

const positions = new Map<string, number>();
let restoring = false;
let cancelRestore: (() => void) | undefined;

function loadPositions(): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'number' &&
        Number.isFinite(item[1])
      ) {
        positions.set(item[0], item[1]);
      }
    }
  } catch {
    // Unreadable storage only means no remembered positions.
  }
}

function savePositions(): void {
  try {
    const entries = [...positions.entries()].slice(-MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A full or blocked storage only costs the reload case.
  }
}

/** The remembered position of an entry, if any. */
export function rememberedScroll(entryId: string): number | undefined {
  return positions.get(entryId);
}

/**
 * Puts the page at `top` and keeps it there while the layout settles. Calling it again, or the
 * user wheeling, touching or pressing a key, ends the previous attempt.
 */
export function restoreScrollWhenSettled(top: number, onDone?: () => void): void {
  cancelRestore?.();
  restoring = true;
  const started = performance.now();
  let stableFrames = 0;
  let lastHeight = -1;
  let frame: number | undefined;
  const finish = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
      window.removeEventListener(name, finish, true);
    }
    if (cancelRestore === finish) cancelRestore = undefined;
    restoring = false;
    onDone?.();
  };
  cancelRestore = finish;
  for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
    window.addEventListener(name, finish, { once: true, passive: true, capture: true });
  }
  const step = (): void => {
    frame = undefined;
    if (performance.now() - started > RESTORE_MAX_MS) {
      finish();
      return;
    }
    const height = document.documentElement.scrollHeight;
    if (Math.abs(window.scrollY - top) > 1) {
      window.scrollTo({ top, behavior: 'instant' });
      stableFrames = 0;
    } else if (height === lastHeight) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
    }
    lastHeight = height;
    if (stableFrames >= SETTLED_FRAMES) {
      finish();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/** Starts remembering and restoring scroll positions. Returns the function that stops it. */
export function installScrollRestoration(): () => void {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  loadPositions();
  let frame: number | undefined;
  const record = (): void => {
    frame = undefined;
    if (restoring) return;
    positions.set(currentHistoryEntry().id, Math.round(window.scrollY));
  };
  const onScroll = (): void => {
    if (restoring || frame !== undefined) return;
    frame = requestAnimationFrame(record);
  };
  const onHide = (): void => {
    if (!restoring) positions.set(currentHistoryEntry().id, Math.round(window.scrollY));
    savePositions();
  };
  const stopArrival = onHistoryArrival((entry, previous) => {
    if (previous?.id === entry.id) return;
    if (entry.layer) return;
    const top = positions.get(entry.id);
    if (top === undefined || isDocumentReadRoute(window.location.hash)) return;
    restoreScrollWhenSettled(top);
  });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  // The entry the page opened on (a reload) gets its position back too.
  const first = currentHistoryEntry();
  const initial = positions.get(first.id);
  if (initial !== undefined && !isDocumentReadRoute(window.location.hash)) {
    restoreScrollWhenSettled(initial);
  }
  return () => {
    stopArrival();
    cancelRestore?.();
    if (frame !== undefined) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
  };
}
