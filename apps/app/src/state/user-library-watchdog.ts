/**
 * A file that is being read must keep making progress. Reading cannot be interrupted from outside
 * (pdf.js, zip inflation, IndexedDB), so a read that stops reporting progress is abandoned: the
 * document is marked failed with a reason and the user can retry it from the card menu.
 */

const MIB = 1024 * 1024;

/** Time without any progress after which the reading of a small file counts as stuck. */
export const INSPECTION_STALL_BASE_MS = 60_000;
/** Extra patience per MiB: one step of a big file (a 5 MB book's text) takes longer on a phone. */
export const INSPECTION_STALL_PER_MIB_MS = 6_000;
export const INSPECTION_STALL_MAX_MS = 300_000;

export function inspectionStallMs(byteLength: number): number {
  const size = Number.isFinite(byteLength) ? Math.max(0, byteLength) : 0;
  return Math.min(
    INSPECTION_STALL_MAX_MS,
    Math.round(INSPECTION_STALL_BASE_MS + (size / MIB) * INSPECTION_STALL_PER_MIB_MS),
  );
}

export class InspectionStalledError extends Error {
  readonly stallMs: number;

  constructor(stallMs: number) {
    super(
      `Файл не удалось прочитать: чтение не продвигалось ${Math.round(stallMs / 1000)} с. ` +
        'Нажмите «Повторить» в меню карточки; если не получится, файл слишком тяжёлый для этого устройства или повреждён.',
    );
    this.name = 'InspectionStalledError';
    this.stallMs = stallMs;
  }
}

/** Thrown inside an abandoned read the moment it touches the watchdog again. */
export class InspectionCancelledError extends Error {
  constructor() {
    super('Чтение файла отменено.');
    this.name = 'InspectionCancelledError';
  }
}

export interface InspectionProgress {
  /** Reports that the read moved forward; restarts the stall timer. */
  readonly touch: () => void;
  /** Throws `InspectionCancelledError` once the read was abandoned; call before every write. */
  readonly assertActive: () => void;
  /** Runs `callback` when the read is abandoned (release a pdf.js document, for instance). */
  readonly onCancel: (callback: () => void) => void;
}

/** For callers that read a file without a watchdog (tests, one-off tools). */
export const UNWATCHED_PROGRESS: InspectionProgress = {
  touch: () => undefined,
  assertActive: () => undefined,
  onCancel: () => undefined,
};

export interface WatchdogTimers {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const DEFAULT_TIMERS: WatchdogTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Runs `task` and rejects with `InspectionStalledError` when it goes `stallMs` without calling
 * `progress.touch()`. The task keeps running after that, but its next `assertActive()` throws and
 * its `onCancel` callbacks have fired, so it cannot write over the failure.
 */
export function runWithProgressWatchdog<T>(
  task: (progress: InspectionProgress) => Promise<T>,
  stallMs: number,
  timers: WatchdogTimers = DEFAULT_TIMERS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let cancelled = false;
    let handle: unknown;
    const cancelCallbacks: (() => void)[] = [];

    const finish = (): void => {
      settled = true;
      if (handle !== undefined) timers.clearTimeout(handle);
      handle = undefined;
    };
    const arm = (): void => {
      if (handle !== undefined) timers.clearTimeout(handle);
      handle = timers.setTimeout(() => {
        if (settled) return;
        cancelled = true;
        finish();
        for (const callback of cancelCallbacks.splice(0)) callback();
        reject(new InspectionStalledError(stallMs));
      }, stallMs);
    };

    const progress: InspectionProgress = {
      touch: () => {
        if (!settled) arm();
      },
      assertActive: () => {
        if (cancelled) throw new InspectionCancelledError();
      },
      onCancel: (callback) => {
        if (cancelled) callback();
        else cancelCallbacks.push(callback);
      },
    };

    arm();
    task(progress).then(
      (value) => {
        if (settled) return;
        finish();
        resolve(value);
      },
      (cause: unknown) => {
        if (settled) return;
        finish();
        reject(cause);
      },
    );
  });
}
