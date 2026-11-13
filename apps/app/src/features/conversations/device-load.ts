/**
 * Whether the device is struggling, for the live speech governor (REC1): a weak phone (≤ 2 GB or
 * ≤ 2 cores) never recognises live, and any phone whose main thread spent more than a third of the
 * last fifteen seconds in long tasks is busy enough that recognition should wait for «Расшифровать».
 * The window is long on purpose: deferring is final for a recording, so a start-up spike must not
 * decide it.
 */
const WINDOW_MS = 15_000;
const BUSY_SHARE = 0.33;

export interface LoadMonitor {
  overloaded(): boolean;
  dispose(): void;
}

export function weakDevice(
  nav: { readonly hardwareConcurrency?: number; readonly deviceMemory?: number } = navigator as {
    hardwareConcurrency?: number;
    deviceMemory?: number;
  },
): boolean {
  return (
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) ||
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2)
  );
}

/** Long-task share of the last `WINDOW_MS`, given the tasks seen (start, duration in ms). */
export function busyShare(
  tasks: readonly { readonly start: number; readonly duration: number }[],
  now: number,
): number {
  let busy = 0;
  for (const task of tasks) {
    const from = Math.max(task.start, now - WINDOW_MS);
    const to = Math.min(task.start + task.duration, now);
    if (to > from) busy += to - from;
  }
  return busy / WINDOW_MS;
}

export function startLoadMonitor(): LoadMonitor {
  const weak = weakDevice();
  const tasks: { start: number; duration: number }[] = [];
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tasks.push({ start: entry.startTime, duration: entry.duration });
      }
      const cutoff = performance.now() - WINDOW_MS;
      while (tasks.length > 0 && (tasks[0]?.start ?? 0) + (tasks[0]?.duration ?? 0) < cutoff) {
        tasks.shift();
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // No long-task timing in this WebView: only the device class decides.
    observer = undefined;
  }
  return {
    overloaded: () => weak || busyShare(tasks, performance.now()) > BUSY_SHARE,
    dispose: () => observer?.disconnect(),
  };
}
