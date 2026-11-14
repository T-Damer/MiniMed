import { Capacitor, registerPlugin } from '@capacitor/core';

import { RELEASE_VERSION } from '../../../../release';
import {
  attachPerfSink,
  codeLabel,
  elementLabel,
  type PerfEntry,
  type PerfScript,
  perfFeatures,
  perfLogOnSince,
  perfNow,
  safeFields,
  setPerfLogEnabled,
  takePerfCounters,
} from './perf-log';
import { screenOf } from './perf-log-screen';

/**
 * The performance log's collector, loaded only while the log is on (`perf-log.ts`). What it adds
 * to the entries the code makes:
 *
 * - long animation frames (≥ 50 ms) with the scripts that ran in them; `longtask` where LoAF is
 *   missing;
 * - slow interactions (Event Timing ≥ 100 ms): input delay, handler time, presentation;
 * - dropped frames from `requestAnimationFrame` deltas, but only for 1.5 s after a touch, a key, a
 *   wheel or a scroll — a loop that always ran would make an idle screen draw every frame;
 * - the screen (`screenOf`) and how long a new one took to settle (no DOM change for 0.5 s);
 * - every 15 s: the counters, the JS heap and, in the Android app, a native sample (CPU of the app
 *   process, temperature, thermal status, memory) taken on a background thread.
 *
 * Entries live in memory in a ring (newest {@link MAX_ENTRIES}) and are written to IndexedDB every
 * minute and whenever the app goes to the background, so a log survives the app being killed.
 */

export const MAX_ENTRIES = 8_000;
const KEEP_SESSIONS = 3;
const TICK_MS = 15_000;
const FLUSH_MS = 60_000;
const NATIVE_INTERVAL_MS = 5_000;
const INTERACTION_WINDOW_MS = 1_500;
const SETTLE_QUIET_MS = 500;
const SETTLE_MAX_MS = 10_000;
const SLOW_EVENT_MS = 100;

export type PerfDeviceInfo = {
  readonly userAgent: string;
  readonly platform: string;
  readonly cores?: number;
  readonly memoryGb?: number;
  readonly screen: string;
  readonly dpr: number;
  readonly loaf: boolean;
  readonly eventTiming: boolean;
  /** Android: from the native plugin. */
  readonly native?: Readonly<Record<string, string | number | boolean>>;
};

export interface PerfSession {
  readonly id: string;
  readonly startedAt: string;
  readonly version: string;
  device: PerfDeviceInfo;
  durationMs: number;
  /** Entries pushed out of the ring. */
  droppedEntries: number;
  entries: PerfEntry[];
  /** Frame-rate estimate from the sampled frames, ms per frame. */
  vsyncMs?: number;
}

interface NativeSampleResult {
  readonly sample?: Readonly<Record<string, number | boolean>>;
  readonly device?: Readonly<Record<string, string | number | boolean>>;
}

interface LocalMedPerfPlugin {
  start(options: { readonly intervalMs: number }): Promise<void>;
  stop(): Promise<void>;
  sample(): Promise<NativeSampleResult>;
}

let nativePerf: LocalMedPerfPlugin | undefined;
function nativePlugin(): LocalMedPerfPlugin | undefined {
  if (Capacitor.getPlatform() !== 'android') return undefined;
  nativePerf ??= registerPlugin<LocalMedPerfPlugin>('LocalMedPerf');
  return nativePerf;
}

let session: PerfSession | undefined;
let origin = 0;
let screen = 'home';
const stopFns: (() => void)[] = [];

function push(entry: PerfEntry): void {
  const current = session;
  if (!current) return;
  current.entries.push(entry);
  if (current.entries.length > MAX_ENTRIES + 500) {
    const extra = current.entries.length - MAX_ENTRIES;
    current.entries.splice(0, extra);
    current.droppedEntries += extra;
  }
}

/** A code entry gets the screen it was made on. */
function fromCode(entry: PerfEntry): void {
  push(entry.s ? entry : { ...entry, s: screen });
}

function withContext(entry: Omit<PerfEntry, 's' | 'a'>): PerfEntry {
  const a = perfFeatures();
  return { ...entry, s: screen, ...(a ? { a } : {}) };
}

function deviceInfo(): PerfDeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const types =
    typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  return {
    userAgent: navigator.userAgent.slice(0, 300),
    platform: Capacitor.getPlatform(),
    ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    ...(nav.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
    screen: `${String(window.screen.width)}x${String(window.screen.height)}`,
    dpr: Math.round(window.devicePixelRatio * 100) / 100,
    loaf: types.includes('long-animation-frame'),
    eventTiming: types.includes('event'),
  };
}

// ── Long frames ─────────────────────────────────────────────────────────────────────────────────

interface LoafScript {
  readonly invoker?: string;
  readonly invokerType?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
  readonly sourceCharPosition?: number;
  readonly duration: number;
  readonly forcedStyleAndLayoutDuration?: number;
}

interface LoafEntry extends PerformanceEntry {
  readonly blockingDuration?: number;
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
  readonly scripts?: readonly LoafScript[];
}

function scriptOf(script: LoafScript): PerfScript {
  const i = codeLabel(script.invoker);
  const it = codeLabel(script.invokerType);
  const u = codeLabel(script.sourceURL);
  const fn = codeLabel(script.sourceFunctionName);
  const fl = script.forcedStyleAndLayoutDuration ?? 0;
  return {
    d: Math.round(script.duration),
    ...(i ? { i } : {}),
    ...(it ? { it } : {}),
    ...(u ? { u } : {}),
    ...(fn ? { fn } : {}),
    ...(script.sourceCharPosition !== undefined && script.sourceCharPosition >= 0
      ? { p: script.sourceCharPosition }
      : {}),
    ...(fl >= 1 ? { fl: Math.round(fl) } : {}),
  };
}

function observeLongFrames(supported: readonly string[]): void {
  if (supported.includes('long-animation-frame')) {
    const observer = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as LoafEntry;
        const scripts = [...(entry.scripts ?? [])]
          .sort((left, right) => right.duration - left.duration)
          .slice(0, 3)
          .map(scriptOf);
        const render =
          entry.renderStart && entry.renderStart > 0
            ? entry.startTime + entry.duration - entry.renderStart
            : 0;
        const layout =
          entry.styleAndLayoutStart && entry.styleAndLayoutStart > 0
            ? entry.startTime + entry.duration - entry.styleAndLayoutStart
            : 0;
        const f = safeFields({
          blocking: entry.blockingDuration ?? 0,
          render,
          layout,
        });
        push(
          withContext({
            t: entry.startTime - origin,
            k: 'frame',
            n: 'loaf',
            d: Math.round(entry.duration),
            ...(f ? { f } : {}),
            ...(scripts.length > 0 ? { x: scripts } : {}),
          }),
        );
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: true });
    stopFns.push(() => observer.disconnect());
    return;
  }
  if (supported.includes('longtask')) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        push(
          withContext({
            t: entry.startTime - origin,
            k: 'task',
            n: 'longtask',
            d: Math.round(entry.duration),
          }),
        );
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    stopFns.push(() => observer.disconnect());
  }
}

// ── Slow interactions ───────────────────────────────────────────────────────────────────────────

interface EventTimingEntry extends PerformanceEntry {
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly target?: Node | null;
  readonly interactionId?: number;
}

function observeSlowEvents(supported: readonly string[]): void {
  if (!supported.includes('event')) return;
  const observer = new PerformanceObserver((list) => {
    for (const raw of list.getEntries()) {
      const entry = raw as EventTimingEntry;
      // One entry per tap or key (`interactionId`); hover and capture events of it are skipped.
      if (entry.duration < SLOW_EVENT_MS || !entry.interactionId) continue;
      const name = /^[a-z]{1,24}$/u.test(entry.name) ? entry.name : 'event';
      const el = elementLabel(entry.target);
      const f = safeFields({
        delay: entry.processingStart - entry.startTime,
        handlers: entry.processingEnd - entry.processingStart,
        paint: entry.startTime + entry.duration - entry.processingEnd,
      });
      push(
        withContext({
          t: entry.startTime - origin,
          k: 'event',
          n: name,
          d: Math.round(entry.duration),
          ...(f ? { f } : {}),
          ...(el ? { el } : {}),
        }),
      );
    }
  });
  observer.observe({
    type: 'event',
    buffered: true,
    durationThreshold: SLOW_EVENT_MS,
  } as PerformanceObserverInit);
  stopFns.push(() => observer.disconnect());
}

// ── Dropped frames while the user interacts ────────────────────────────────────────────────────

/** Running estimate of one frame at the display's rate (8.3 ms at 120 Hz). */
let vsync = 1000 / 60;

/** Frames that took more than one refresh: how many refreshes were missed. */
export function missedRefreshes(deltaMs: number, frameMs: number): number {
  return Math.max(0, Math.round(deltaMs / frameMs) - 1);
}

function sampleFramesOnInteraction(): void {
  let until = 0;
  let frame = 0;
  let last = 0;
  let windowStart = 0;
  let frames = 0;
  let dropped = 0;
  let over50 = 0;
  let worst = 0;
  const deltas: number[] = [];
  const finish = (): void => {
    if (frames >= 3) {
      const sorted = deltas.slice().sort((left, right) => left - right);
      const low = sorted[Math.floor(sorted.length * 0.1)] ?? vsync;
      // Only a smooth stretch tells the refresh rate; clamp to 30–165 Hz.
      if (low > 5 && low < 34) vsync = Math.min(vsync, Math.max(6, low));
      if (session) session.vsyncMs = Math.round(vsync * 100) / 100;
      const f = safeFields({ frames, dropped, over50, worst, vsync });
      push(
        withContext({
          t: windowStart - origin,
          k: 'jank',
          n: 'frames',
          d: Math.round(last - windowStart),
          ...(f ? { f } : {}),
        }),
      );
    }
    frames = 0;
    dropped = 0;
    over50 = 0;
    worst = 0;
    deltas.length = 0;
    last = 0;
  };
  const tick = (time: number): void => {
    frame = 0;
    if (last > 0) {
      const delta = time - last;
      frames += 1;
      deltas.push(delta);
      dropped += missedRefreshes(delta, vsync);
      if (delta > 50) over50 += 1;
      if (delta > worst) worst = delta;
    } else {
      windowStart = time;
    }
    last = time;
    if (time < until && document.visibilityState === 'visible') {
      frame = requestAnimationFrame(tick);
    } else {
      finish();
    }
  };
  const arm = (): void => {
    until = performance.now() + INTERACTION_WINDOW_MS;
    if (frame === 0) frame = requestAnimationFrame(tick);
  };
  const options = { capture: true, passive: true } as const;
  const events = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchmove'] as const;
  for (const name of events) document.addEventListener(name, arm, options);
  stopFns.push(() => {
    for (const name of events) document.removeEventListener(name, arm, options);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  });
}

// ── Screens ─────────────────────────────────────────────────────────────────────────────────────

function trackScreens(): void {
  let settleObserver: MutationObserver | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const endSettle = (): void => {
    settleObserver?.disconnect();
    settleObserver = undefined;
    clearTimeout(settleTimer);
  };
  const enter = (next: string, from: string | undefined): void => {
    screen = next;
    const startedAt = performance.now();
    push({
      t: startedAt - origin,
      k: 'route',
      n: 'enter',
      s: next,
      ...(from ? { f: { fromDepth: from.split('/').length } } : {}),
    });
    endSettle();
    let lastChange = startedAt;
    let mutations = 0;
    let firstFrame = 0;
    requestAnimationFrame(() =>
      requestAnimationFrame((time) => {
        firstFrame = time - startedAt;
      }),
    );
    const done = (): void => {
      endSettle();
      const f = safeFields({
        firstFrame,
        mutations,
        capped: lastChange - startedAt >= SETTLE_MAX_MS,
      });
      push({
        t: startedAt - origin,
        k: 'settle',
        n: 'screen',
        s: next,
        d: Math.round(lastChange - startedAt),
        ...(f ? { f } : {}),
      });
    };
    const quiet = (): void => {
      clearTimeout(settleTimer);
      const elapsed = performance.now() - startedAt;
      if (elapsed >= SETTLE_MAX_MS) {
        done();
        return;
      }
      settleTimer = setTimeout(done, Math.min(SETTLE_QUIET_MS, SETTLE_MAX_MS - elapsed));
    };
    settleObserver = new MutationObserver((records) => {
      mutations += records.length;
      lastChange = performance.now();
      quiet();
    });
    settleObserver.observe(document.body, { childList: true, subtree: true });
    quiet();
  };
  const onHash = (): void => {
    const next = screenOf(window.location.hash);
    if (next !== screen) enter(next, screen);
  };
  enter(screenOf(window.location.hash), undefined);
  window.addEventListener('hashchange', onHash);
  stopFns.push(() => {
    window.removeEventListener('hashchange', onHash);
    endSettle();
  });
}

// ── Periodic samples ────────────────────────────────────────────────────────────────────────────

interface ChromeMemory {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

const MB = 1_048_576;

async function nativeSample(): Promise<void> {
  const plugin = nativePlugin();
  if (!plugin || !session) return;
  const result = await plugin.sample();
  if (result.device && !session.device.native) {
    session.device = { ...session.device, native: result.device };
  }
  const sample = result.sample;
  if (!sample) return;
  const epoch = typeof sample['epochMs'] === 'number' ? sample['epochMs'] : undefined;
  const t = epoch === undefined ? perfNow() : epoch - performance.timeOrigin - origin;
  const { epochMs: _epoch, ...rest } = sample;
  const f = safeFields(rest);
  push({ t, k: 'native', n: 'sample', s: screen, ...(f ? { f } : {}) });
}

let lastTickAt = 0;

function tick(): void {
  if (perfLogOnSince() === undefined) {
    // Timed out (or turned off in another tab): stop with a last write.
    void setPerfLogEnabled(false);
    return;
  }
  const started = performance.now();
  // Counters cover the time since the previous tick.
  const windowFrom = lastTickAt || origin;
  lastTickAt = started;
  for (const counter of takePerfCounters()) {
    const f = safeFields({ calls: counter.calls, ms: counter.ms, max: counter.max });
    push({
      t: windowFrom - origin,
      k: 'count',
      n: counter.name,
      s: screen,
      d: Math.round(started - windowFrom),
      ...(f ? { f } : {}),
    });
  }
  const memory = (performance as Performance & { memory?: ChromeMemory }).memory;
  if (memory) {
    const f = safeFields({
      usedMb: memory.usedJSHeapSize / MB,
      totalMb: memory.totalJSHeapSize / MB,
      limitMb: memory.jsHeapSizeLimit / MB,
    });
    push(withContext({ t: started - origin, k: 'mem', n: 'heap', ...(f ? { f } : {}) }));
  }
  void nativeSample().catch(() => undefined);
  if (session) session.durationMs = Math.round(perfNow());
  const spent = performance.now() - started;
  push({
    t: windowFrom - origin,
    k: 'count',
    n: 'perflog.tick',
    d: Math.round(started - windowFrom),
    f: { calls: 1, ms: Math.round(spent * 10) / 10, max: Math.round(spent * 10) / 10 },
  });
}

function startTicks(): void {
  // A first sample soon after the start, then every 15 s.
  const first = setTimeout(tick, 1_000);
  const timer = setInterval(tick, TICK_MS);
  const flushTimer = setInterval(() => void flushPerfSession(), FLUSH_MS);
  const onVisibility = (): void => {
    const hidden = document.visibilityState === 'hidden';
    push({ t: perfNow(), k: 'vis', n: hidden ? 'hidden' : 'visible', s: screen });
    if (hidden) void flushPerfSession();
  };
  document.addEventListener('visibilitychange', onVisibility);
  stopFns.push(() => {
    clearTimeout(first);
    clearInterval(timer);
    clearInterval(flushTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  });
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'minimed-perf-log';
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('perf log storage'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('perf log storage'));
      transaction.onabort = () => reject(transaction.error ?? new Error('perf log storage'));
    });
  } finally {
    db.close();
  }
}

let flushing: Promise<void> | undefined;

/** Writes the current session (its newest entries) to IndexedDB. */
export async function flushPerfSession(): Promise<void> {
  const current = session;
  if (!current) return;
  if (flushing) return flushing;
  const started = performance.now();
  current.durationMs = Math.round(perfNow());
  const copy: PerfSession = { ...current, entries: current.entries.slice() };
  flushing = withStore('readwrite', (store) => store.put(copy))
    .then(() => {
      push({
        t: started - origin,
        k: 'span',
        n: 'perflog.flush',
        s: screen,
        d: Math.round(performance.now() - started),
        f: { entries: copy.entries.length },
      });
    })
    .catch((cause: unknown) => {
      console.warn('Журнал производительности не сохранён.', cause);
    })
    .finally(() => {
      flushing = undefined;
    });
  return flushing;
}

/** Every stored session, oldest first, with the running one as it is now. */
export async function readPerfSessions(): Promise<PerfSession[]> {
  // The counters and memory up to this moment.
  if (session) tick();
  const stored = (await withStore<PerfSession[]>('readonly', (store) => store.getAll())) ?? [];
  const byId = new Map(stored.map((item) => [item.id, item]));
  if (session) {
    session.durationMs = Math.round(perfNow());
    byId.set(session.id, { ...session, entries: session.entries.slice() });
  }
  return [...byId.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export async function clearPerfSessions(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
  if (session) {
    session.entries = [];
    session.droppedEntries = 0;
  }
}

async function pruneSessions(): Promise<void> {
  const stored = (await withStore<PerfSession[]>('readonly', (store) => store.getAll())) ?? [];
  const old = stored
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(0, Math.max(0, stored.length - (KEEP_SESSIONS - 1)));
  if (old.length === 0) return;
  await withStore('readwrite', (store) => {
    for (const item of old) store.delete(item.id);
    return undefined;
  });
}

/** How much the running log holds, for the settings row. */
export function perfLogProgress():
  | { readonly entries: number; readonly minutes: number }
  | undefined {
  if (!session) return undefined;
  return { entries: session.entries.length + session.droppedEntries, minutes: perfNow() / 60_000 };
}

// ── Start / stop ────────────────────────────────────────────────────────────────────────────────

export function startPerfCollector(logOrigin: number): void {
  if (session) return;
  origin = logOrigin;
  lastTickAt = 0;
  screen = screenOf(window.location.hash);
  session = {
    id: `${new Date()
      .toISOString()
      .replace(/[^0-9]/gu, '')
      .slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date(performance.timeOrigin + logOrigin).toISOString(),
    version: RELEASE_VERSION,
    device: deviceInfo(),
    durationMs: 0,
    droppedEntries: 0,
    entries: [],
  };
  attachPerfSink(fromCode);
  const supported =
    typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  try {
    observeLongFrames(supported);
    observeSlowEvents(supported);
  } catch (cause) {
    console.warn('Журнал производительности: наблюдатели недоступны.', cause);
  }
  // The app's own timing marks (search, start-up, module installs) without their details.
  if (supported.includes('mark')) {
    const marks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.startsWith('minimed:') || entry.name.length > 48) continue;
        if (!/^[a-z0-9:._-]+$/u.test(entry.name)) continue;
        push({
          t: entry.startTime - origin,
          k: 'mark',
          n: entry.name,
          s: screen,
          ...(entry.duration > 0 ? { d: Math.round(entry.duration) } : {}),
        });
      }
    });
    marks.observe({ entryTypes: ['mark', 'measure'] });
    stopFns.push(() => marks.disconnect());
  }
  sampleFramesOnInteraction();
  trackScreens();
  startTicks();
  const plugin = nativePlugin();
  if (plugin) {
    void plugin.start({ intervalMs: NATIVE_INTERVAL_MS }).catch(() => undefined);
    stopFns.push(() => void plugin.stop().catch(() => undefined));
  }
  void pruneSessions().catch(() => undefined);
}

export async function stopPerfCollector(): Promise<void> {
  for (const stop of stopFns.splice(0)) stop();
  attachPerfSink(undefined);
  takePerfCounters();
  await flushPerfSession();
  session = undefined;
}
