import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { LOCAL_DATA_ROOT } from './local-data';

/**
 * Shared probes of the performance measurement (`perf-baseline.spec.ts`) and the budget check
 * (`perf-budget.spec.ts`): a per-frame sampler of what is on screen, long tasks, OPFS-worker call
 * times and the browser's own counters (layouts, style recalculations, heap, DOM nodes).
 */

const ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Installed before the app's code: records long tasks, every frame's time and a few selectors'
 * presence per frame, and times each OPFS-worker call (`{ id, type: 'call', method }` → the
 * message with the same id and a result or error).
 */
export function installPerfProbes(): void {
  interface WorkerCall {
    method: string;
    start: number;
    end?: number;
  }
  interface Sample {
    t: number;
    flags: number;
    count: number;
  }
  const state = window as unknown as {
    __perf: {
      longTasks: { start: number; duration: number }[];
      frames: number[];
      calls: WorkerCall[];
      samples: Sample[];
      selectors: string[];
      countSelector: string;
      sampling: boolean;
      keys: number[];
    };
  };
  state.__perf = {
    longTasks: [],
    frames: [],
    calls: [],
    samples: [],
    selectors: [],
    countSelector: '',
    sampling: false,
    keys: [],
  };
  const perf = state.__perf;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // Long tasks are a Chromium API; other engines measure without them.
  }
  let last = performance.now();
  const tick = (now: number): void => {
    perf.frames.push(now - last);
    last = now;
    if (perf.sampling) {
      let flags = 0;
      perf.selectors.forEach((selector, index) => {
        if (document.querySelector(selector)) flags |= 1 << index;
      });
      const count = perf.countSelector ? document.querySelectorAll(perf.countSelector).length : 0;
      perf.samples.push({ t: now, flags, count });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // The keystroke reference is the input event: Playwright types non-Latin text with
  // `insertText`, which sends no keydown (and a phone keyboard often sends none either).
  window.addEventListener(
    'input',
    () => {
      perf.keys.push(performance.now());
    },
    { capture: true },
  );
  const NativeWorker = window.Worker;
  class TimedWorker extends NativeWorker {
    private readonly open = new Map<number, WorkerCall>();
    public constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { id?: unknown; result?: unknown; error?: unknown } | null;
        if (!data || typeof data.id !== 'number') return;
        if (!('result' in data) && !('error' in data)) return;
        const call = this.open.get(data.id);
        if (!call) return;
        call.end = performance.now();
        this.open.delete(data.id);
      });
    }
    public override postMessage(message: unknown, ...rest: unknown[]): void {
      const data = message as { id?: unknown; type?: unknown; method?: unknown } | null;
      if (data && typeof data.id === 'number' && data.type === 'call') {
        const call: WorkerCall = { method: String(data.method), start: performance.now() };
        if ((window as unknown as { __perfStacks?: boolean }).__perfStacks)
          (call as WorkerCall & { stack?: string }).stack = (new Error().stack ?? '')
            .split('\n')
            .slice(2, 9)
            .map((line) => line.trim().replace(/https?:\/\/[^/]+\/assets\//u, ''))
            .join(' | ');
        perf.calls.push(call);
        this.open.set(data.id, call);
      }
      (super.postMessage as (...args: unknown[]) => void)(message, ...rest);
    }
  }
  window.Worker = TimedWorker as typeof Worker;
}

export interface PerfSample {
  readonly t: number;
  readonly flags: number;
  readonly count: number;
}

/** Starts per-frame sampling of `selectors` (bit i set when selector i is on the page). */
export async function startSampling(
  page: Page,
  selectors: readonly string[],
  countSelector = '',
): Promise<number> {
  return page.evaluate(
    ({ list, count }) => {
      const perf = (
        window as unknown as {
          __perf: {
            samples: unknown[];
            selectors: string[];
            countSelector: string;
            sampling: boolean;
            keys: number[];
          };
        }
      ).__perf;
      perf.samples = [];
      perf.keys = [];
      perf.selectors = [...list];
      perf.countSelector = count;
      perf.sampling = true;
      return performance.now();
    },
    { list: selectors, count: countSelector },
  );
}

export interface SampledWindow {
  readonly samples: readonly PerfSample[];
  readonly keys: readonly number[];
  readonly longTasks: readonly { start: number; duration: number }[];
  readonly calls: readonly { method: string; start: number; end?: number }[];
  readonly frames: readonly number[];
}

export async function stopSampling(page: Page, from: number): Promise<SampledWindow> {
  return page.evaluate((start) => {
    const perf = (
      window as unknown as {
        __perf: {
          samples: PerfSample[];
          keys: number[];
          sampling: boolean;
          longTasks: { start: number; duration: number }[];
          calls: { method: string; start: number; end?: number }[];
          frames: number[];
        };
      }
    ).__perf;
    perf.sampling = false;
    return {
      samples: perf.samples,
      keys: perf.keys,
      longTasks: perf.longTasks.filter((task) => task.start + task.duration >= start),
      calls: perf.calls.filter((call) => call.start >= start),
      frames: [],
    };
  }, from);
}

/** Waits until `predicate(sample)` has held for `quietMs` of frames; returns the first such frame's time. */
export async function waitForSettled(
  page: Page,
  predicate: string,
  quietMs: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ body, quiet }) => {
      const perf = (window as unknown as { __perf: { samples: PerfSample[] } }).__perf;
      const test = new Function('s', `return (${body});`) as (sample: PerfSample) => boolean;
      const samples = perf.samples;
      if (samples.length === 0) return false;
      const lastSample = samples.at(-1);
      if (!lastSample || !test(lastSample)) return false;
      let index = samples.length - 1;
      while (index > 0 && test(samples[index - 1] as PerfSample)) index -= 1;
      return lastSample.t - (samples[index] as PerfSample).t >= quiet;
    },
    { body: predicate, quiet: quietMs },
    { timeout: timeoutMs, polling: 100 },
  );
}

export function longTaskSummary(
  tasks: readonly { start: number; duration: number }[],
  from: number,
  to: number,
): { count: number; totalMs: number; maxMs: number; blockingMs: number } {
  const inside = tasks.filter((task) => task.start < to && task.start + task.duration > from);
  return {
    count: inside.length,
    totalMs: Math.round(inside.reduce((sum, task) => sum + task.duration, 0)),
    maxMs: Math.round(Math.max(0, ...inside.map((task) => task.duration))),
    blockingMs: Math.round(inside.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
  };
}

export function workerCallSummary(
  calls: readonly { method: string; start: number; end?: number }[],
): Record<string, { count: number; totalMs: number; maxMs: number }> {
  const out: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
  for (const call of calls) {
    if (call.end === undefined) continue;
    const ms = call.end - call.start;
    const entry = out[call.method] ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count += 1;
    entry.totalMs += ms;
    entry.maxMs = Math.max(entry.maxMs, ms);
    out[call.method] = entry;
  }
  for (const entry of Object.values(out)) {
    entry.totalMs = Math.round(entry.totalMs);
    entry.maxMs = Math.round(entry.maxMs);
  }
  return out;
}

export async function frameStats(page: Page, from: number): Promise<Record<string, number>> {
  return page.evaluate((start) => {
    const perf = (
      window as unknown as {
        __perf: { frames: number[]; longTasks: { start: number; duration: number }[] };
      }
    ).__perf;
    const frames = perf.frames.slice(start).toSorted((a, b) => a - b);
    const at = (fraction: number): number => frames[Math.floor(frames.length * fraction)] ?? 0;
    return {
      frames: frames.length,
      frameMsP50: Math.round(at(0.5)),
      frameMsP95: Math.round(at(0.95)),
      frameMsMax: Math.round(frames.at(-1) ?? 0),
      // A frame over 25 ms missed at least one 60 Hz vsync.
      framesOver25ms: frames.filter((value) => value > 25).length,
      framesOver50ms: frames.filter((value) => value > 50).length,
    };
  }, from);
}

export async function frameCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __perf: { frames: number[] } }).__perf.frames.length,
  );
}

const METRIC_NAMES = [
  'LayoutCount',
  'RecalcStyleCount',
  'LayoutDuration',
  'RecalcStyleDuration',
  'ScriptDuration',
  'TaskDuration',
  'JSHeapUsedSize',
  'Nodes',
] as const;

export type BrowserMetrics = Record<(typeof METRIC_NAMES)[number], number>;

export async function browserMetrics(cdp: CDPSession): Promise<BrowserMetrics> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const out = {} as BrowserMetrics;
  for (const name of METRIC_NAMES) out[name] = metrics.find((m) => m.name === name)?.value ?? 0;
  return out;
}

/** Counter differences; durations in ms, heap in MB (the later value, not a difference). */
export function metricsDelta(
  before: BrowserMetrics,
  after: BrowserMetrics,
): Record<string, number> {
  return {
    layouts: after.LayoutCount - before.LayoutCount,
    styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000),
    styleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000),
    scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
    heapMB: Math.round(after.JSHeapUsedSize / 1e5) / 10,
    domNodes: after.Nodes,
  };
}

interface ProfileNode {
  readonly id: number;
  readonly children?: readonly number[];
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
}

export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

export function topSelfTime(profile: CpuProfile, limit = 25): readonly string[] {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const node = byNode.get(id);
    if (!node) return;
    const frame = node.callFrame;
    const file = frame.url.split('/').at(-1) ?? '';
    const key = `${frame.functionName || '(anonymous)'} ${file}:${String(frame.lineNumber + 1)}:${String(frame.columnNumber + 1)}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...totals.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`);
}

let localModuleFiles: Map<string, string> | undefined;

function walk(directory: string, into: Map<string, string[]>): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, into);
    else if (name.endsWith('.zst')) into.set(name, [...(into.get(name) ?? []), path]);
  }
}

/**
 * Serves every catalog module whose published bytes are among the local release copies
 * (`output/module-zstd-*` of the main checkout), picking the copy whose hash the catalog pins.
 */
export async function routeLocalCatalogModules(context: BrowserContext): Promise<void> {
  if (!localModuleFiles) {
    const candidates = new Map<string, string[]>();
    const outputRoot = resolve(LOCAL_DATA_ROOT, 'output');
    if (existsSync(outputRoot)) {
      for (const name of readdirSync(outputRoot)) {
        if (name.startsWith('module-zstd-')) walk(join(outputRoot, name), candidates);
      }
    }
    const catalog = ContentModuleCatalogSchema.parse(
      JSON.parse(
        readFileSync(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
      ),
    );
    const pinned = new Map<string, string>();
    for (const module of catalog.modules) {
      for (const artifact of module.artifacts) {
        if (!artifact.url || !artifact.sha256) continue;
        pinned.set(new URL(artifact.url).pathname.split('/').at(-1) ?? '', artifact.sha256);
      }
    }
    localModuleFiles = new Map();
    for (const [name, paths] of candidates) {
      const sha = pinned.get(name);
      if (!sha) continue;
      // The newest directory first; hash only until the pinned copy is found.
      for (const path of paths.toSorted().toReversed()) {
        const digest = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
        if (digest === sha) {
          localModuleFiles.set(name, path);
          break;
        }
      }
    }
  }
  const files = localModuleFiles;
  await context.route(
    (url) => files.has(url.pathname.split('/').at(-1) ?? ''),
    (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
      const path = files.get(name);
      if (!path) return route.abort();
      return route.fulfill({
        body: readFileSync(path),
        contentType: 'application/zstd',
        headers: { 'access-control-allow-origin': '*' },
      });
    },
  );
}

export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Who calls the costliest built-in functions (layout reads, selectors): the nearest script frames. */
export function nativeCallers(
  profile: CpuProfile,
  names: readonly string[] = [
    'getBoundingClientRect',
    'getClientRects',
    'querySelector',
    'querySelectorAll',
    'getComputedStyle',
    'getAnimations',
  ],
  limit = 12,
): readonly string[] {
  const parent = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const node = byNode.get(id);
    if (!node || !names.includes(node.callFrame.functionName) || node.callFrame.url) return;
    const chain: string[] = [];
    let up = parent.get(id);
    while (up !== undefined && chain.length < 3) {
      const frame = byNode.get(up)?.callFrame;
      if (frame?.url) {
        chain.push(
          `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1) ?? ''}:${String(frame.lineNumber + 1)}:${String(frame.columnNumber + 1)}`,
        );
      }
      up = parent.get(up);
    }
    const key = `${node.callFrame.functionName} <- ${chain.join(' <- ')}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...totals.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`);
}

/** The frames at which the sampled flags changed, relative to `from`: «t ms: flags». */
export function flagTimeline(samples: readonly PerfSample[], from: number): readonly string[] {
  const out: string[] = [];
  let last = -1;
  for (const sample of samples) {
    if (sample.flags === last) continue;
    last = sample.flags;
    out.push(
      `${String(Math.round(sample.t - from))}: ${sample.flags.toString(2)} (${String(sample.count)})`,
    );
  }
  return out;
}
