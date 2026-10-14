/**
 * Debounced, ordered autosave for typed text. Every change is handed to `writeAhead` at once (a
 * cheap copy that survives a reload), the durable `save` runs after the typing pauses, saves never
 * overlap or reorder, and every live saver is flushed when the page is hidden or unloaded.
 *
 * `save` receives the newest value only; a failed save keeps the value pending and is retried by
 * the next change, flush or return to the page. Errors go to `onError`, never away.
 */
export interface DebouncedSaverOptions<T> {
  /** Idle time after the last change before the durable save starts (read at every change). */
  readonly delayMs?: number | (() => number);
  readonly save: (value: T) => Promise<void>;
  /** Called synchronously on every change with the change's version number. */
  readonly writeAhead?: (value: T, version: number) => void;
  /** Called after the newest value is saved; older write-ahead copies are obsolete from then on. */
  readonly onSaved?: (value: T, version: number) => void;
  readonly onError: (error: unknown) => void;
  readonly onPendingChange?: (pending: boolean) => void;
}

export interface DebouncedSaver<T> {
  /** Records a change. */
  readonly schedule: (value: T) => void;
  /** Saves now; resolves `true` when nothing is left unsaved. */
  readonly flush: () => Promise<boolean>;
  readonly pending: () => boolean;
  /** Stops the timer and leaves the lifecycle registry; flush first to keep pending text. */
  readonly dispose: () => void;
}

export const DEFAULT_SAVE_DELAY_MS = 350;

const liveSavers = new Set<DebouncedSaver<never>>();
let lifecycleInstalled = false;

/** Starts a durable save for every saver that holds unsaved text. */
export function flushPendingSaves(): Promise<boolean[]> {
  return Promise.all([...liveSavers].filter((saver) => saver.pending()).map((s) => s.flush()));
}

function retryPendingSaves(): void {
  void flushPendingSaves();
}

function installLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;
  // `pagehide` and `beforeunload` cover reloads, tab closes and navigation away; the hidden state
  // covers a phone switching apps, where the page may never be shown again.
  window.addEventListener('pagehide', retryPendingSaves);
  window.addEventListener('beforeunload', retryPendingSaves);
  window.addEventListener('freeze', retryPendingSaves);
  document.addEventListener('visibilitychange', retryPendingSaves);
  window.addEventListener('pageshow', retryPendingSaves);
  window.addEventListener('online', retryPendingSaves);
}

export function createDebouncedSaver<T>(options: DebouncedSaverOptions<T>): DebouncedSaver<T> {
  const delayMs = (): number =>
    typeof options.delayMs === 'function'
      ? options.delayMs()
      : (options.delayMs ?? DEFAULT_SAVE_DELAY_MS);
  let newest: { readonly value: T; readonly version: number } | null = null;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<boolean> = Promise.resolve(true);
  let reportedPending = false;

  const reportPending = (): void => {
    const now = newest !== null;
    if (now === reportedPending) return;
    reportedPending = now;
    options.onPendingChange?.(now);
  };
  const clearTimer = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const drain = async (): Promise<boolean> => {
    while (newest) {
      const attempt = newest;
      try {
        await options.save(attempt.value);
      } catch (error) {
        options.onError(error);
        return false;
      }
      // A change made while the save ran stays pending and is saved by the next pass.
      if (newest === attempt) {
        newest = null;
        options.onSaved?.(attempt.value, attempt.version);
      }
    }
    reportPending();
    return true;
  };
  const run = (): Promise<boolean> => {
    clearTimer();
    chain = chain.then(drain, drain);
    return chain;
  };

  const saver: DebouncedSaver<T> = {
    schedule: (value) => {
      version += 1;
      newest = { value, version };
      reportPending();
      options.writeAhead?.(value, version);
      clearTimer();
      timer = setTimeout(() => void run(), delayMs());
    },
    flush: () => (newest ? run() : chain.then(() => true)),
    pending: () => newest !== null,
    dispose: () => {
      clearTimer();
      liveSavers.delete(saver as DebouncedSaver<never>);
    },
  };
  liveSavers.add(saver as DebouncedSaver<never>);
  installLifecycle();
  return saver;
}
