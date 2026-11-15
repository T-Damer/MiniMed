/**
 * Lets a long loop on the main thread give the thread back. `slice()` returns a promise only when
 * the running piece has used its budget; a short loop never waits and never leaves its task:
 *
 *   const slice = createTimeSlicer();
 *   for (const item of items) { work(item); const due = slice(); if (due) await due; }
 */
export type TimeSlicer = () => Promise<void> | undefined;

/** A pending tap or frame gets the thread within this many milliseconds. */
export const DEFAULT_SLICE_MS = 8;

function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createTimeSlicer(budgetMs = DEFAULT_SLICE_MS): TimeSlicer {
  let startedAt = performance.now();
  return () => {
    if (performance.now() - startedAt < budgetMs) return undefined;
    return nextTask().then(() => {
      startedAt = performance.now();
    });
  };
}
