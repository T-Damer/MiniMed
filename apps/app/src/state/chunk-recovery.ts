/**
 * A lazily loaded screen can fail to arrive: the page belongs to an older build whose chunk the
 * deploy removed (404), or the network is gone. The first case is repaired by one reload onto the
 * current build; the second is shown in place (LazyBoundary), never as an endless spinner.
 */

export const CHUNK_RELOAD_KEY = 'minimed:chunk-reload:v1';
/** A second reload inside this window means the reload did not help: stop instead of looping. */
export const CHUNK_RELOAD_GUARD_MS = 60_000;

// Chromium, Firefox and Safari word a failed dynamic import differently.
const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading (?:css )?chunk [\w-]+ failed/iu;

export function isChunkLoadError(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : '';
  return CHUNK_ERROR_PATTERN.test(message);
}

export type ChunkRecoveryOutcome =
  /** The page is being reloaded onto the current build. */
  | 'reloading'
  /** No network: a reload cannot fetch anything; the screen shows its own error. */
  | 'offline'
  /** A reload already happened a moment ago and the chunk is still missing. */
  | 'guarded';

export interface ChunkRecoveryEnvironment {
  readonly online: () => boolean;
  readonly now: () => number;
  readonly reload: () => void;
  /** `sessionStorage`; undefined when blocked. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    // Blocked storage: the guard falls back to the in-memory flag below.
    return undefined;
  }
}

let reloadRequested = false;

function defaultEnvironment(): ChunkRecoveryEnvironment {
  return {
    online: () => navigator.onLine,
    now: () => Date.now(),
    reload: () => window.location.reload(),
    storage: sessionStorageOrUndefined(),
  };
}

/** The `now` of the last reload, if it is still inside the guard window. */
function recentReload(environment: ChunkRecoveryEnvironment): boolean {
  if (reloadRequested) return true;
  const raw = environment.storage?.getItem(CHUNK_RELOAD_KEY);
  const at = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(at) && environment.now() - at < CHUNK_RELOAD_GUARD_MS;
}

/** Reloads once onto the current build, unless offline or a reload just failed to help. */
export function recoverFromChunkError(
  environment: ChunkRecoveryEnvironment = defaultEnvironment(),
): ChunkRecoveryOutcome {
  if (!environment.online()) return 'offline';
  if (recentReload(environment)) return 'guarded';
  reloadRequested = true;
  try {
    environment.storage?.setItem(CHUNK_RELOAD_KEY, String(environment.now()));
  } catch (cause) {
    // The in-memory flag still stops a loop inside this page; a new page may reload once more.
    console.warn('Не удалось сохранить отметку перезагрузки.', cause);
  }
  environment.reload();
  return 'reloading';
}

/** Test seam: forgets the in-memory flag. */
export function resetChunkRecoveryForTests(): void {
  reloadRequested = false;
}

interface PreloadErrorEvent extends Event {
  readonly payload?: unknown;
}

/**
 * Listens for Vite's `vite:preloadError` and for rejected dynamic imports nobody handled. The
 * error is never swallowed: the lazy component still fails and LazyBoundary shows it while the
 * reload (online only) replaces the page.
 */
export function installChunkRecovery(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  environment?: ChunkRecoveryEnvironment,
): () => void {
  const recover = (): void => {
    recoverFromChunkError(environment);
  };
  const onPreloadError = (event: Event): void => {
    // A module that arrived but threw while evaluating is a bug, not a missing chunk.
    if (isChunkLoadError((event as PreloadErrorEvent).payload)) recover();
  };
  const onRejection = (event: Event): void => {
    if (isChunkLoadError((event as PromiseRejectionEvent).reason)) recover();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('vite:preloadError', onPreloadError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * The user's explicit «Повторить» on a screen that would not load. Online it also drops the app's
 * worker and shell caches so the next load takes the current build from the network;
 * offline it only reloads (the worker may still hold a working shell).
 */
export async function reloadFromNetwork(
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  if (navigator.onLine) {
    try {
      // Only the app's own worker; the patient diary keeps its worker (scope `diary/`).
      const registration = await navigator.serviceWorker?.getRegistration?.();
      await registration?.unregister();
      const names = (await globalThis.caches?.keys?.()) ?? [];
      await Promise.all(
        names
          .filter((name) => name.startsWith('minimed-shell-'))
          .map((name) => caches.delete(name)),
      );
    } catch (cause) {
      console.warn('Не удалось сбросить кэш приложения перед перезагрузкой.', cause);
    }
  }
  reload();
}
