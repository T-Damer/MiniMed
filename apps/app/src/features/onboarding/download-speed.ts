/**
 * Download speed for the core progress line: bytes per second, smoothed over successive
 * `loaded` samples. The core arrives as one stream whose progress events are bursty, so a raw
 * delta jumps between zero and several megabytes per second; an exponential average with a
 * time-based weight keeps the number readable without hiding a real slowdown.
 */

export interface SpeedState {
  /** Time and byte count of the last sample that fed the average. */
  readonly at: number;
  readonly loaded: number;
  /** Smoothed bytes per second; undefined until two spread-out samples exist. */
  readonly speed: number | undefined;
}

/** Time constant of the average: about this long to follow a change in the real speed. */
export const SPEED_SMOOTHING_MS = 3_000;
/** Samples closer than this are folded into the next one instead of producing a noisy delta. */
export const SPEED_MIN_INTERVAL_MS = 250;
/** No new bytes for this long: the speed is unknown rather than a stale number. */
export const SPEED_STALL_MS = 6_000;

export function startSpeed(at: number, loaded: number): SpeedState {
  return { at, loaded, speed: undefined };
}

/** Folds one `loaded` sample, taken at `at` (ms), into the state. Pure. */
export function nextSpeed(state: SpeedState, at: number, loaded: number): SpeedState {
  // A smaller count means a new transfer (retry, restart): begin again.
  if (!Number.isFinite(loaded) || loaded < state.loaded) return startSpeed(at, Math.max(0, loaded));
  const elapsed = at - state.at;
  if (elapsed < SPEED_MIN_INTERVAL_MS) return state;
  const instant = ((loaded - state.loaded) * 1000) / elapsed;
  if (state.speed === undefined) return { at, loaded, speed: instant };
  const weight = 1 - Math.exp(-elapsed / SPEED_SMOOTHING_MS);
  return { at, loaded, speed: state.speed + (instant - state.speed) * weight };
}

/** The speed to show at time `now`: undefined when unknown or when the transfer has stalled. */
export function currentSpeed(state: SpeedState, now: number): number | undefined {
  if (state.speed === undefined || state.speed <= 0) return undefined;
  return now - state.at > SPEED_STALL_MS ? undefined : state.speed;
}

const KIB = 1024;
const MIB = KIB * 1024;

function decimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** «4,2 МБ/с», «850 КБ/с»; the same units as the rest of the app's sizes. */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= MIB) {
    const value = bytesPerSecond / MIB;
    return `${value >= 10 ? Math.round(value) : decimal(value)} МБ/с`;
  }
  return `${Math.max(1, Math.round(bytesPerSecond / KIB))} КБ/с`;
}
