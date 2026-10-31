import { type Accessor, createSignal, onCleanup } from 'solid-js';

/**
 * How smoothly the app is drawing right now, for the search home's pulse (owner 2026-10-29): the
 * ECG trace turns yellow and beats faster when frames are being dropped, red and faster still when
 * the app is struggling. Chromium reports slow frames by itself (`long-animation-frame`, else
 * `longtask`), so watching costs nothing; WebKit has neither, so it counts frames for one second
 * every ten, and only while someone is watching and the page is visible.
 */
export type FrameHealth = 'good' | 'strained' | 'poor';

/** One measured window: how much of it the main thread spent blocked, as a fraction (0–1). */
export interface FrameWindow {
  readonly blockedFraction: number;
}

const STRAINED_FROM = 0.04;
const POOR_FROM = 0.15;

/**
 * The state after a window: worse at once, better only after two calm windows in a row, so one
 * quiet second does not flip a struggling app back to green.
 */
export function nextFrameHealth(
  current: FrameHealth,
  window: FrameWindow,
  calmWindows: number,
): { readonly health: FrameHealth; readonly calmWindows: number } {
  const measured: FrameHealth =
    window.blockedFraction >= POOR_FROM
      ? 'poor'
      : window.blockedFraction >= STRAINED_FROM
        ? 'strained'
        : 'good';
  const rank = { good: 0, strained: 1, poor: 2 } as const;
  if (rank[measured] >= rank[current]) return { health: measured, calmWindows: 0 };
  const calm = calmWindows + 1;
  if (calm < 2) return { health: current, calmWindows: calm };
  return { health: measured, calmWindows: 0 };
}

/** How much faster the pulse runs in each state. */
export const PULSE_RATE: Readonly<Record<FrameHealth, number>> = {
  good: 1,
  strained: 1.6,
  poor: 2.4,
};

const WINDOW_MS = 5000;
const SAMPLE_MS = 1000;
const SAMPLE_EVERY_MS = 10_000;
/** A frame this much longer than one at 60 Hz counts its excess as blocked time. */
const FRAME_BUDGET_MS = 1000 / 60;

function observedEntryType(): 'long-animation-frame' | 'longtask' | undefined {
  const types =
    typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  if (types.includes('long-animation-frame')) return 'long-animation-frame';
  if (types.includes('longtask')) return 'longtask';
  return undefined;
}

/** The frame health while the calling component is mounted. */
export function useFrameHealth(): Accessor<FrameHealth> {
  const [health, setHealth] = createSignal<FrameHealth>('good');
  let calm = 0;
  const record = (blockedFraction: number): void => {
    const next = nextFrameHealth(health(), { blockedFraction }, calm);
    calm = next.calmWindows;
    setHealth(next.health);
  };
  const type = observedEntryType();
  if (type) {
    let blocked = 0;
    // A frame's report arrives after the frame: the start-up frames that ended just after the pulse
    // appeared were counted as if the app were struggling now (yellow for ten seconds after every
    // start on the owner's phone). Only frames that began while the pulse was watching count.
    const watchingSince = performance.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < watchingSince) continue;
        // The part of a long frame or task past 50 ms is what held input and drawing up.
        const reported = (entry as PerformanceEntry & { readonly blockingDuration?: number })
          .blockingDuration;
        blocked += reported ?? Math.max(0, entry.duration - 50);
      }
    });
    observer.observe({ type, buffered: false });
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      record(Math.min(1, blocked / WINDOW_MS));
      blocked = 0;
    }, WINDOW_MS);
    onCleanup(() => {
      observer.disconnect();
      clearInterval(timer);
    });
    return health;
  }
  // WebKit: count dropped frames for a second every ten.
  let frame = 0;
  const sample = (): void => {
    if (document.visibilityState !== 'visible') return;
    let last = performance.now();
    const startedAt = last;
    let over = 0;
    const tick = (now: number): void => {
      over += Math.max(0, now - last - FRAME_BUDGET_MS);
      last = now;
      if (now - startedAt < SAMPLE_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      record(Math.min(1, over / (now - startedAt)));
    };
    frame = requestAnimationFrame(tick);
  };
  const timer = setInterval(sample, SAMPLE_EVERY_MS);
  sample();
  onCleanup(() => {
    clearInterval(timer);
    cancelAnimationFrame(frame);
  });
  return health;
}
