import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BrowserContext, type CDPSession, chromium, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';
import { type CpuProfile, routeLocalCatalogModules, topSelfTime } from './perf-harness';

/**
 * PERF6 (owner 2026-11-11 «телефон греется при переходах и работе»): what each main screen keeps
 * doing while nobody touches it, and what the screens kept alive behind it add. Not a gate; run it
 * on purpose after `perf-baseline` has filled the profile (core + КР 714_2 installed):
 *
 *   bun run build:app
 *   PERF_IDLE=1 E2E_PORT=4291 bunx playwright test perf-idle --workers=1
 *
 * Per screen, after it settles: CPU time of every browser process (renderer, GPU/compositor,
 * browser) over an idle window, main-thread task time, compositor frames drawn, timer and
 * animation-frame callbacks by source, network requests, infinite animations still running, DOM
 * nodes and heap. A phone: 390×844 at 2.75×, touch, CPU throttled `PERF_THROTTLE`× (default 4).
 */
test.skip(!process.env['PERF_IDLE'], 'idle measurement; run with PERF_IDLE=1');

const ROOT = resolve(import.meta.dirname, '../../..');
const THROTTLE = Number(process.env['PERF_THROTTLE'] ?? '4');
const SETTLE_MS = Number(process.env['PERF_SETTLE_MS'] ?? '5000');
const WINDOW_MS = Number(process.env['PERF_WINDOW_MS'] ?? '8000');
const PROFILE_DIR = process.env['PERF_PROFILE_DIR'] ?? resolve(ROOT, 'playwright/perf-profile');
const b64 = (id: string): string => Buffer.from(id).toString('base64url');
/** `PERF_SCREENS=diaries,search` measures only screens whose name contains one of these. */
const ONLY = (process.env['PERF_SCREENS'] ?? '').split(',').filter(Boolean);
/** `PERF_CSS` is added to every page: an experiment (a part switched off) without a build. */
const EXTRA_CSS = process.env['PERF_CSS'] ?? '';

/** The screens in the order a doctor might walk through them; the last ones repeat the first. */
const SCREENS = [
  ['search home', '#/search'],
  ['files', '#/modules/documents/user'],
  ['knowledge base', '#/modules'],
  ['notes', '#/notes'],
  ['diaries', '#/notes/diaries'],
  ['news', '#/news'],
  ['calculators', '#/calculators'],
  ['assessments', '#/assessments'],
  ['ECG by photo', '#/calculators/ecg-photo-caliper'],
  ['drug interactions', '#/notes/drug-interactions'],
  ['settings', '#/settings'],
  ['reader КР 714_2', `#/modules/documents/d/${b64('kr.rf.714_2')}`],
  ['search home (after the loop)', '#/search'],
  ['settings (after the loop)', '#/settings'],
] as const;

/** Counts what the page itself schedules: timers and frames by the place that asked for them. */
function installIdleProbes(): void {
  const counts = new Map<string, number>();
  const where = (): string => {
    const lines = (new Error().stack ?? '').split('\n').slice(3, 6);
    const frame = lines.find((line) => !line.includes('installIdleProbes')) ?? '?';
    return frame
      .trim()
      .replace(/^at /u, '')
      .replace(/https?:\/\/[^/]+\//u, '')
      .slice(0, 140);
  };
  const bump = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const state = { counts, fetches: 0, messages: 0 };
  (window as unknown as { __idle: typeof state }).__idle = state;
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeInterval = window.setInterval.bind(window);
  const nativeFrame = window.requestAnimationFrame.bind(window);
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const key = `timeout ${where()}`;
    if (typeof handler !== 'function') return nativeTimeout(handler, ms, ...args);
    return nativeTimeout(
      (...inner: unknown[]) => {
        bump(key);
        (handler as (...a: unknown[]) => void)(...inner);
      },
      ms,
      ...args,
    );
  }) as typeof window.setTimeout;
  window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const key = `interval(${ms ?? 0}) ${where()}`;
    if (typeof handler !== 'function') return nativeInterval(handler, ms, ...args);
    return nativeInterval(
      (...inner: unknown[]) => {
        bump(key);
        (handler as (...a: unknown[]) => void)(...inner);
      },
      ms,
      ...args,
    );
  }) as typeof window.setInterval;
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const key = `frame ${where()}`;
    return nativeFrame((time) => {
      bump(key);
      callback(time);
    });
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    state.fetches += 1;
    return nativeFetch(...args);
  }) as typeof fetch;
  const nativePost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function post(this: Worker, ...args: unknown[]) {
    state.messages += 1;
    return (nativePost as (...a: unknown[]) => void).apply(this, args);
  } as typeof Worker.prototype.postMessage;
}

interface ProcessTimes {
  readonly [type: string]: number;
}

function parseCpuTime(value: string): number {
  // macOS ps: [[dd-]hh:]mm:ss.cc
  const [days, rest] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = (rest ?? '').split(':').map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return (Number(days) * 86_400 + seconds) * 1000;
}

/** CPU ms so far of the browser that owns the profile and all its children, by process type. */
function processTimes(): ProcessTimes {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      ms: parseCpuTime(match[3] ?? '0'),
      command: match[4] ?? '',
    }));
  const root = rows.find(
    (row) =>
      row.command.includes(`--user-data-dir=${PROFILE_DIR}`) && !row.command.includes('--type='),
  );
  if (!root) return {};
  const family = new Set([root.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!family.has(row.pid) && family.has(row.ppid)) {
        family.add(row.pid);
        grew = true;
      }
    }
  }
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!family.has(row.pid)) continue;
    const type = row.command.match(/--type=(\S+)/u)?.[1] ?? 'browser';
    const name =
      type === 'utility'
        ? `utility:${row.command.match(/--utility-sub-type=(\S+)/u)?.[1] ?? '?'}`
        : type;
    out[name] = (out[name] ?? 0) + row.ms;
  }
  return out;
}

function diffTimes(before: ProcessTimes, after: ProcessTimes): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[key] ?? 0) - (before[key] ?? 0);
    if (delta > 0) out[key] = delta;
  }
  out['total'] = Object.values(out).reduce((sum, value) => sum + value, 0);
  return out;
}

const METRICS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'LayoutCount',
  'RecalcStyleCount',
  'Nodes',
  'JSHeapUsedSize',
  'JSEventListeners',
] as const;

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(
    METRICS.map((name) => [name, list.find((m) => m.name === name)?.value ?? 0]),
  );
}

/** Compositor frames drawn and main-thread frames begun during `ms`. */
async function traceFrames(cdp: CDPSession, ms: number): Promise<{ drawn: number; main: number }> {
  let drawn = 0;
  let main = 0;
  const onData = (payload: { value: { name?: string }[] }): void => {
    for (const event of payload.value) {
      if (event.name === 'DrawFrame') drawn += 1;
      if (event.name === 'BeginMainThreadFrame') main += 1;
    }
  };
  cdp.on('Tracing.dataCollected', onData);
  await cdp.send('Tracing.start', {
    categories: 'disabled-by-default-devtools.timeline.frame,devtools.timeline',
    transferMode: 'ReportEvents',
  });
  await new Promise((done) => setTimeout(done, ms));
  const complete = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
  await cdp.send('Tracing.end');
  await complete;
  cdp.off('Tracing.dataCollected', onData);
  return { drawn, main };
}

async function pageState(page: Page) {
  return page.evaluate(() => {
    const idle = (
      window as unknown as {
        __idle: { counts: Map<string, number>; fetches: number; messages: number };
      }
    ).__idle;
    const counts = [...idle.counts.entries()];
    const animations = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => {
        const timing = animation.effect?.getComputedTiming();
        const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
        const name =
          (animation as CSSAnimation).animationName ??
          (animation as CSSTransition).transitionProperty ??
          animation.id ??
          'animation';
        return {
          name,
          infinite: timing?.iterations === Number.POSITIVE_INFINITY,
          target: target
            ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
            : '',
        };
      });
    return {
      counts,
      fetches: idle.fetches,
      messages: idle.messages,
      animations,
      hiddenViews: document.querySelectorAll('.app-view[hidden]').length,
    };
  });
}

function countDelta(
  before: readonly [string, number][],
  after: readonly [string, number][],
): [string, number][] {
  const start = new Map(before);
  return after
    .map(([key, value]) => [key, value - (start.get(key) ?? 0)] as [string, number])
    .filter(([, value]) => value > 0)
    .toSorted((a, b) => b[1] - a[1]);
}

async function openContext(): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.75,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
    args: ['--mute-audio'],
  });
  await context.addInitScript(installIdleProbes);
  await context.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    window.localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  await routeLocalCatalogModules(context);
  return context;
}

test('idle cost of each screen and of the screens kept alive behind it', async () => {
  test.setTimeout(30 * 60_000);
  const context = await openContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 600_000, polling: 500 },
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  // Start-up work (warm-up, catalog, installed calculators) must not count as idle.
  await page.waitForTimeout(15_000);
  const rows: Record<string, unknown>[] = [];
  if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
  const screens = SCREENS.filter(
    ([name]) => ONLY.length === 0 || ONLY.some((part) => name.includes(part)),
  );
  for (const [name, hash] of screens) {
    await page.evaluate((target) => {
      window.location.hash = target;
    }, hash);
    await page.waitForTimeout(SETTLE_MS);
    const before = {
      cpu: processTimes(),
      metrics: await metrics(cdp),
      page: await pageState(page),
    };
    const frames = await traceFrames(cdp, WINDOW_MS);
    const after = { cpu: processTimes(), metrics: await metrics(cdp), page: await pageState(page) };
    const perSecond = 1000 / WINDOW_MS;
    const cpu = diffTimes(before.cpu, after.cpu);
    const row = {
      screen: name,
      hash,
      cpuMsPerSecond: Object.fromEntries(
        Object.entries(cpu).map(([key, value]) => [key, Math.round(value * perSecond)]),
      ),
      mainTaskMsPerSecond: Math.round(
        (after.metrics['TaskDuration'] - before.metrics['TaskDuration']) * 1000 * perSecond,
      ),
      scriptMsPerSecond: Math.round(
        (after.metrics['ScriptDuration'] - before.metrics['ScriptDuration']) * 1000 * perSecond,
      ),
      layoutsPerSecond: +(
        (after.metrics['LayoutCount'] - before.metrics['LayoutCount']) *
        perSecond
      ).toFixed(1),
      stylesPerSecond: +(
        (after.metrics['RecalcStyleCount'] - before.metrics['RecalcStyleCount']) *
        perSecond
      ).toFixed(1),
      framesDrawnPerSecond: +(frames.drawn * perSecond).toFixed(1),
      mainFramesPerSecond: +(frames.main * perSecond).toFixed(1),
      callbacks: countDelta(before.page.counts, after.page.counts).slice(0, 8),
      fetches: after.page.fetches - before.page.fetches,
      workerMessages: after.page.messages - before.page.messages,
      runningAnimations: after.page.animations,
      nodes: after.metrics['Nodes'],
      listeners: after.metrics['JSEventListeners'],
      heapMb: +(after.metrics['JSHeapUsedSize'] / 1048576).toFixed(1),
      hiddenViews: after.page.hiddenViews,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const out = process.env['PERF_OUT'] ?? resolve(ROOT, `playwright/perf-idle-${Date.now()}.json`);
  writeFileSync(
    out,
    `${JSON.stringify({ throttle: THROTTLE, windowMs: WINDOW_MS, rows }, null, 2)}\n`,
  );
  await context.close();
});

/**
 * `PERF_LOOPS=n`: walk the screens n times (a short pause on each) and record, after each walk,
 * the heap after a forced GC, DOM nodes and listeners — growth that keeps going walk after walk
 * is a leak; growth that stops after the first walk is the screens kept alive.
 */
test('memory over repeated navigation loops', async () => {
  const loops = Number(process.env['PERF_LOOPS'] ?? '0');
  test.skip(loops === 0, 'run with PERF_LOOPS=n');
  test.setTimeout(30 * 60_000);
  const context = await openContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 600_000, polling: 500 },
  );
  await page.waitForTimeout(10_000);
  const sample = async (label: string) => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await metrics(cdp);
    const row = {
      label,
      heapMb: +(m['JSHeapUsedSize'] / 1048576).toFixed(1),
      nodes: m['Nodes'],
      listeners: m['JSEventListeners'],
      cpu: processTimes(),
    };
    console.log(JSON.stringify(row));
    return row;
  };
  const rows = [await sample('start')];
  const pause = Number(process.env['PERF_LOOP_PAUSE_MS'] ?? '1500');
  for (let loop = 1; loop <= loops; loop += 1) {
    const before = processTimes();
    const started = Date.now();
    for (const [name, hash] of SCREENS) {
      await page.evaluate((target) => {
        window.location.hash = target;
      }, hash);
      await page.waitForTimeout(pause);
      if (process.env['PERF_LOOP_DETAIL']) {
        await cdp.send('HeapProfiler.collectGarbage');
        const attached = await page.evaluate(() => document.getElementsByTagName('*').length);
        console.log(JSON.stringify({ loop, name, nodes: (await metrics(cdp))['Nodes'], attached }));
      }
    }
    const walkMs = Date.now() - started;
    const row = await sample(`after walk ${loop}`);
    rows.push({ ...row, walkCpuMs: diffTimes(before, row.cpu), walkMs } as typeof row);
  }
  const out = process.env['PERF_OUT'] ?? resolve(ROOT, `playwright/perf-loops-${Date.now()}.json`);
  writeFileSync(out, `${JSON.stringify({ loops, pause, rows }, null, 2)}\n`);
  await context.close();
});

/**
 * `PERF_NAV=1`: what one switch between screens costs once every screen has been visited (kept
 * alive): main-thread script/style/layout and the CPU of every process for 2 s after the address
 * changes, and a CPU profile of a whole warm walk (top self time).
 */
test('cost of switching between screens that are already mounted', async () => {
  test.skip(!process.env['PERF_NAV'], 'run with PERF_NAV=1');
  test.setTimeout(30 * 60_000);
  const context = await openContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 600_000, polling: 500 },
  );
  await page.waitForTimeout(10_000);
  page.on('console', (message) => {
    if (message.text().includes('PERF6-PROBE') || ['warning', 'error'].includes(message.type()))
      console.log(message.type(), message.text().slice(0, 600));
  });
  const navScreens = SCREENS.filter(
    ([name]) => ONLY.length === 0 || ONLY.some((part) => name.includes(part)),
  );
  const go = (hash: string) =>
    page.evaluate((target) => {
      window.location.hash = target;
    }, hash);
  // A first walk mounts everything (catalog, lazy chunks): not counted.
  for (const [, hash] of navScreens) {
    await go(hash);
    await page.waitForTimeout(2000);
  }
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  // `PERF_NAV_PROFILE=reader` profiles only the switches to screens whose name contains it.
  const profiled = process.env['PERF_NAV_PROFILE'] ?? '';
  if (!profiled) await cdp.send('Profiler.start');
  const rows: Record<string, unknown>[] = [];
  const tops: Record<string, readonly string[]> = {};
  for (const [name, hash] of navScreens) {
    const profileThis = profiled !== '' && name.includes(profiled);
    if (profileThis) await cdp.send('Profiler.start');
    const before = { cpu: processTimes(), m: await metrics(cdp) };
    await go(hash);
    await page.waitForTimeout(2000);
    const after = { cpu: processTimes(), m: await metrics(cdp) };
    if (profileThis) {
      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
      tops[name] = topSelfTime(profile, 30);
      if (process.env['PERF_PROFILE_OUT'])
        writeFileSync(process.env['PERF_PROFILE_OUT'], JSON.stringify(profile));
      console.log(`== ${name}\n${tops[name].join('\n')}`);
    }
    const ms = (key: string) => Math.round((after.m[key] - before.m[key]) * 1000);
    const row = {
      screen: name,
      cpu: diffTimes(before.cpu, after.cpu),
      task: ms('TaskDuration'),
      script: ms('ScriptDuration'),
      style: ms('RecalcStyleDuration'),
      layout: ms('LayoutDuration'),
      styles: after.m['RecalcStyleCount'] - before.m['RecalcStyleCount'],
      layouts: after.m['LayoutCount'] - before.m['LayoutCount'],
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  let top: readonly string[] = [];
  if (!profiled) {
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
    top = topSelfTime(profile, 40);
    console.log(top.join('\n'));
  }
  const out = process.env['PERF_OUT'] ?? resolve(ROOT, `playwright/perf-nav-${Date.now()}.json`);
  writeFileSync(out, `${JSON.stringify({ rows, top, tops }, null, 2)}\n`);
  await context.close();
});
