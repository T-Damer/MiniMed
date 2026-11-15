/**
 * Paces the search-core rebuilds of a long run of background installs.
 *
 * A download queue resumed after a restart finishes a module every few seconds, and each finished
 * module asked for a rebuild of the whole core: on a phone one rebuild holds the main thread for
 * seconds, so the rebuilds ran back to back for as long as the queue lasted (29 in 8 minutes in the
 * owner's performance log, 0.6.99) and every screen stuttered. The core is now rebuilt at once
 * only when nothing else is installing; while more modules are on their way it is rebuilt at most
 * once per `minGapMs`, and the last finished module always gets its rebuild.
 */
export interface ReconnectPacerOptions {
  readonly reconnect: () => void;
  /** Whether other installs are still queued or running. */
  readonly hasPendingInstalls: () => boolean;
  readonly minGapMs: number;
  readonly now?: () => number;
}

export interface ReconnectPacer {
  /** A module finished installing. */
  readonly request: () => void;
  readonly dispose: () => void;
}

export const BULK_INSTALL_RECONNECT_GAP_MS = 120_000;

export function createReconnectPacer(options: ReconnectPacerOptions): ReconnectPacer {
  const now = options.now ?? (() => performance.now());
  let lastAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastAt = now();
    options.reconnect();
  };

  return {
    request: () => {
      if (!options.hasPendingInstalls()) {
        fire();
        return;
      }
      if (timer !== undefined) return;
      const wait = lastAt === undefined ? 0 : lastAt + options.minGapMs - now();
      if (wait <= 0) fire();
      // The queue may end without another finished module (a failure, a pause): the timer still
      // connects what was installed.
      else timer = setTimeout(fire, wait);
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
