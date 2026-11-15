/**
 * Lets a model worker go after it has been idle: a loaded model (and the WebAssembly heap that
 * holds it) otherwise stays in memory until the app closes, whether or not it is used again.
 * `busy()` when a request starts, `idle()` when no request is left; `release` runs `idleMs` after
 * the last `idle()` unless work arrived meanwhile. The next request starts a fresh worker.
 */
export interface IdleRelease {
  readonly busy: () => void;
  readonly idle: () => void;
}

export const MODEL_IDLE_RELEASE_MS = 2 * 60_000;

export function createIdleRelease(
  release: () => void,
  idleMs = MODEL_IDLE_RELEASE_MS,
): IdleRelease {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    busy: cancel,
    idle: () => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        release();
      }, idleMs);
    },
  };
}
