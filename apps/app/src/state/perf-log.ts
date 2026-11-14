/**
 * The opt-in performance log (PERFLOG1, owner 2026-11-14 «метка на релизах»). Off by default; the
 * doctor turns it on in Settings → «Основные» → «Журнал производительности» (or with `?perf=1` in a
 * browser), uses the app as usual, and shares the log with «Поделиться журналом».
 *
 * This module is the small part every feature imports: the on/off flag and the `perfMark`,
 * `perfSpan` and `perfCount` calls. While the log is off each call is one boolean check and
 * returns; nothing observes, samples or stores. When it is on, the collector
 * (`perf-log-collector.ts`, loaded only then) receives the entries and adds what the browser reports
 * by itself: long animation frames, slow interactions, dropped frames, screens, memory.
 *
 * **No content.** An entry carries only timings, counts and fixed names from the code: names and
 * enum-like string values must match {@link SAFE_NAME} / {@link SAFE_VALUE}; anything else is
 * dropped here, so a query, a transcript line or a patient's name can never be logged by mistake.
 */

export const PERF_LOG_KEY = 'minimed.perf-log.v1';
export const PERF_LOG_EVENT = 'minimed:perf-log';

/** Entry kinds. `mark`/`span`/`count` come from the code; the rest from the collector. */
export type PerfEntryKind =
  | 'mark'
  | 'span'
  | 'count'
  | 'frame'
  | 'task'
  | 'event'
  | 'jank'
  | 'route'
  | 'settle'
  | 'mem'
  | 'native'
  | 'vis';

export type PerfFieldValue = number | boolean | string;
export type PerfFields = Readonly<Record<string, PerfFieldValue>>;

export interface PerfEntry {
  /** Start, ms since the log session began (`performance.now()` based). */
  readonly t: number;
  readonly k: PerfEntryKind;
  readonly n: string;
  /** Duration, ms. */
  readonly d?: number;
  /** The screen at the time (`screenOf`). */
  readonly s?: string;
  /** Features running at the time (open spans and states, e.g. `recorder.recording`). */
  readonly a?: readonly string[];
  readonly f?: PerfFields;
  /** Long frames: the scripts that ran longest in it (`codeLabel`-cleaned). */
  readonly x?: readonly PerfScript[];
  /** Slow interactions: the element, as `tag.bem-class` (`elementLabel`). */
  readonly el?: string;
}

/** One script of a long animation frame, as Chromium attributes it. */
export interface PerfScript {
  /** Invoker: `BUTTON#id.onclick`, `DOMWindow.onmessage`, `Response.json.then`. */
  readonly i?: string;
  /** Invoker type: `event-listener`, `resolve-promise`, `user-callback`, `classic-script`. */
  readonly it?: string;
  /** Script file name, query and path dropped: `ConversationRecorder-Bx12.js`. */
  readonly u?: string;
  /** Function name (minified in a release build). */
  readonly fn?: string;
  /** Character position in that file, to map with the build's source map. */
  readonly p?: number;
  readonly d: number;
  /** Forced style and layout inside it, ms. */
  readonly fl?: number;
}

/** A label from the code (an invoker, a file name): letters, digits and `#._:$-`, at most 64. */
export function codeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  // A URL keeps only its file name; a query or hash could carry anything.
  const withoutUrls = value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]*/giu, (url) => {
    const path = url.split(/[?#]/u)[0] ?? '';
    return path.split('/').filter(Boolean).at(-1) ?? 'url';
  });
  const cleaned = withoutUrls.replace(/[^A-Za-z0-9#._:$-]+/gu, '_').slice(0, 64);
  return cleaned || undefined;
}

/** An element as `tag.class.class` (two BEM classes at most); ids and text are never read. */
export function elementLabel(node: unknown): string | undefined {
  if (!node || typeof node !== 'object' || !('tagName' in node)) return undefined;
  const element = node as Element;
  const tag = element.tagName.toLowerCase().replace(/[^a-z0-9-]/gu, '');
  const classes = Array.from(element.classList ?? [])
    .filter((name) => /^[a-z][a-z0-9_-]{0,47}$/u.test(name))
    .slice(0, 2);
  return [tag, ...classes].join('.').slice(0, 96) || undefined;
}

/** A name from the code: `recorder.start`, `asr.stretch`, `minimed:search:core`. */
export const SAFE_NAME = /^[a-z0-9][a-z0-9._:-]{0,47}$/u;
/** A field key: `engine`, `audioS`. */
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/u;
/** An enum-like string value: `native`, `whisper`, `backlog`. Never free text. */
export const SAFE_VALUE = /^[a-z0-9][a-z0-9._-]{0,31}$/u;

/** Keeps only fields that cannot carry content; rounds numbers to 0.1. */
export function safeFields(
  fields: Readonly<Record<string, unknown>> | undefined,
): PerfFields | undefined {
  if (!fields) return undefined;
  const out: Record<string, PerfFieldValue> = {};
  let dropped = 0;
  let kept = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEY.test(key)) {
      dropped += 1;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = Math.round(value * 10) / 10;
      kept += 1;
    } else if (typeof value === 'boolean') {
      out[key] = value;
      kept += 1;
    } else if (typeof value === 'string' && SAFE_VALUE.test(value)) {
      out[key] = value;
      kept += 1;
    } else if (value !== undefined) {
      dropped += 1;
    }
  }
  if (dropped > 0) out['dropped'] = dropped;
  return kept > 0 || dropped > 0 ? out : undefined;
}

let on = false;
let origin = 0;
let sink: ((entry: PerfEntry) => void) | undefined;
/** Entries made before the collector finished loading; bounded. */
const early: PerfEntry[] = [];
const EARLY_MAX = 500;
const running = new Map<string, number>();
const counters = new Map<string, { calls: number; ms: number; max: number }>();

function now(): number {
  return performance.now() - origin;
}

function emit(entry: PerfEntry): void {
  if (sink) sink(entry);
  else if (early.length < EARLY_MAX) early.push(entry);
}

function features(): readonly string[] | undefined {
  return running.size === 0 ? undefined : [...running.keys()];
}

/** Whether the log is recording now. */
export function perfLogOn(): boolean {
  return on;
}

/** ms since the log session began, for collector entries. */
export function perfNow(): number {
  return now();
}

/** The features running right now, for collector entries (long frames, slow taps). */
export function perfFeatures(): readonly string[] | undefined {
  return features();
}

/** A moment: `perfMark('recorder.pause')`. */
export function perfMark(name: string, fields?: Readonly<Record<string, unknown>>): void {
  if (!on || !SAFE_NAME.test(name)) return;
  const f = safeFields(fields);
  emit({ t: now(), k: 'mark', n: name, ...(f ? { f } : {}) });
}

const NO_END = (): void => undefined;

/**
 * A stretch of work: `const end = perfSpan('asr.stretch', { engine }); … end({ audioS })`. While it
 * runs, its name is in every long frame's `a` list, so a frame can be blamed on it.
 */
export function perfSpan(
  name: string,
  fields?: Readonly<Record<string, unknown>>,
): (endFields?: Readonly<Record<string, unknown>>) => void {
  if (!on || !SAFE_NAME.test(name)) return NO_END;
  const start = now();
  running.set(name, (running.get(name) ?? 0) + 1);
  let ended = false;
  return (endFields) => {
    if (ended) return;
    ended = true;
    const left = (running.get(name) ?? 1) - 1;
    if (left > 0) running.set(name, left);
    else running.delete(name);
    if (!on) return;
    const f = safeFields({ ...fields, ...endFields });
    emit({ t: start, k: 'span', n: name, d: now() - start, ...(f ? { f } : {}) });
  };
}

/**
 * A frequent small step (a waveform draw, a microphone block): only a count and the time it took,
 * summed and written once per collector tick instead of one entry per call.
 */
export function perfCount(name: string, ms = 0): void {
  if (!on) return;
  const counter = counters.get(name);
  if (counter) {
    counter.calls += 1;
    counter.ms += ms;
    if (ms > counter.max) counter.max = ms;
  } else if (SAFE_NAME.test(name)) {
    counters.set(name, { calls: 1, ms, max: ms });
  }
}

/** Counters since the last call, emptied; for the collector's tick. */
export function takePerfCounters(): readonly {
  name: string;
  calls: number;
  ms: number;
  max: number;
}[] {
  const out = [...counters].map(([name, counter]) => ({ name, ...counter }));
  counters.clear();
  return out;
}

/** Hands entries to the collector (and the early ones made while it loaded). */
export function attachPerfSink(next: ((entry: PerfEntry) => void) | undefined): void {
  sink = next;
  if (next) for (const entry of early.splice(0)) next(entry);
}

/** The log turns itself off this long after it was turned on, so a forgotten switch stops. */
export const PERF_LOG_AUTO_OFF_MS = 48 * 3_600_000;

/** When the log was turned on (epoch ms), or undefined when it is off or has timed out. */
export function perfLogOnSince(nowMs: number = Date.now()): number | undefined {
  try {
    const stored = localStorage.getItem(PERF_LOG_KEY);
    if (!stored) return undefined;
    const since = Number(stored);
    // `1` from an address flag written before a clock was read: counts as «just now».
    if (!Number.isFinite(since) || since < 1e12) return nowMs;
    if (nowMs - since > PERF_LOG_AUTO_OFF_MS) {
      localStorage.removeItem(PERF_LOG_KEY);
      return undefined;
    }
    return since;
  } catch {
    return undefined;
  }
}

function readStored(): boolean {
  return perfLogOnSince() !== undefined;
}

function writeStored(enabled: boolean): void {
  try {
    if (!enabled) localStorage.removeItem(PERF_LOG_KEY);
    else if (perfLogOnSince() === undefined) localStorage.setItem(PERF_LOG_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the log runs for this visit only.
  }
}

/** `?perf=1` / `?perf=0` in the address (before or inside the hash) turns the log on or off. */
export function perfFlagFromAddress(href: string): boolean | undefined {
  const match = /[?&]perf=([01])(?:[&#]|$)/u.exec(href);
  if (!match) return undefined;
  return match[1] === '1';
}

let collector: Promise<typeof import('./perf-log-collector')> | undefined;

function loadCollector(): Promise<typeof import('./perf-log-collector')> {
  collector ??= import('./perf-log-collector');
  return collector;
}

function startRecording(): void {
  on = true;
  origin = performance.now();
  void loadCollector().then(
    (module) => {
      if (on) module.startPerfCollector(origin);
    },
    (cause: unknown) => {
      on = false;
      console.warn('Журнал производительности не запустился.', cause);
    },
  );
}

/** At start-up, before the first render: resumes the log if it was left on. */
export function initPerfLog(href: string = window.location.href): void {
  const fromAddress = perfFlagFromAddress(href);
  if (fromAddress !== undefined) writeStored(fromAddress);
  if (fromAddress ?? readStored()) startRecording();
}

/** The settings switch. Turning it off stops recording; the log so far stays until «Очистить». */
export async function setPerfLogEnabled(enabled: boolean): Promise<void> {
  writeStored(enabled);
  if (enabled === on) return;
  if (enabled) {
    startRecording();
  } else {
    on = false;
    running.clear();
    counters.clear();
    early.length = 0;
    const module = await loadCollector();
    await module.stopPerfCollector();
  }
  window.dispatchEvent(new CustomEvent(PERF_LOG_EVENT));
}
