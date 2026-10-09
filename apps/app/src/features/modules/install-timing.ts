/**
 * Phase timings of a module installation, recorded as User Timing measures named
 * `minimed:install:<phase>` (visible in the DevTools Performance panel; the install e2e reads them).
 * A worker has its own clock, so its phases travel as epoch milliseconds and are re-based here.
 */

export const INSTALL_MEASURE_PREFIX = 'minimed:install:';

/** A phase measured on another thread, in epoch milliseconds (`timeOrigin + now`). */
export interface EpochInstallPhase {
  readonly phase: string;
  readonly startEpochMs: number;
  readonly endEpochMs: number;
}

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

function record(phase: string, start: number, end: number, detail: unknown): void {
  try {
    performance.measure(`${INSTALL_MEASURE_PREFIX}${phase}`, { start, end, detail });
  } catch {
    // Timing is diagnostics only; it never decides whether an installation succeeds.
  }
}

export function recordInstallPhase(phase: string, startedAt: number, detail?: unknown): void {
  record(phase, startedAt, performance.now(), detail);
}

/** A phase known only by its summed duration, laid out from `startedAt`. */
export function recordInstallDuration(phase: string, startedAt: number, durationMs: number): void {
  record(phase, startedAt, startedAt + durationMs, undefined);
}

export function recordEpochInstallPhase(phase: EpochInstallPhase, detail?: unknown): void {
  record(
    phase.phase,
    phase.startEpochMs - performance.timeOrigin,
    phase.endEpochMs - performance.timeOrigin,
    detail,
  );
}

export async function timeInstallPhase<T>(
  phase: string,
  run: () => Promise<T>,
  detail?: unknown,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    recordInstallPhase(phase, startedAt, detail);
  }
}

/** Instant at which a task entered `state`; the gaps between states are the unmeasured steps. */
export function markInstallState(moduleId: string, state: string): void {
  try {
    performance.mark(`${INSTALL_MEASURE_PREFIX}state:${state}`, { detail: { moduleId } });
  } catch {
    // Diagnostics only.
  }
}
