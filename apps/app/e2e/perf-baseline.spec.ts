import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';
import {
  browserMetrics,
  type CpuProfile,
  flagTimeline,
  frameCount,
  frameStats,
  installPerfProbes,
  longTaskSummary,
  median,
  metricsDelta,
  nativeCallers,
  routeLocalCatalogModules,
  startSampling,
  stopSampling,
  topSelfTime,
  waitForSettled,
  workerCallSummary,
} from './perf-harness';

/**
 * PERF5 (owner 2026-11-08 «speed up search, reading especially»): the rerunnable measurement of
 * start-up, search and the reader on the production build with the real 440 MB core and the
 * largest published documents. Not a gate (see `perf-budget.spec.ts`); run it on purpose:
 *
 *   bun run build:app
 *   PERF_BASELINE=1 E2E_PORT=4291 bunx playwright test perf-baseline --workers=1
 *
 * A phone: 390×844 at 2.75×, touch, CPU throttled `PERF_THROTTLE`× (default 4). The browser
 * profile (`playwright/perf-profile`, OPFS with the core and the modules) is kept between runs, so
 * only the first run downloads and installs; later runs measure an app start with data in place.
 * The report goes to `PERF_OUT` (default `playwright/perf-<time>.json`); compare two reports with
 * `bun scripts/perf-compare.ts before.json after.json`.
 */
test.skip(!process.env['PERF_BASELINE'], 'performance measurement; run with PERF_BASELINE=1');

const ROOT = resolve(import.meta.dirname, '../../..');
const THROTTLE = Number(process.env['PERF_THROTTLE'] ?? '4');
const REPEATS = Number(process.env['PERF_REPEATS'] ?? '3');
const PROFILE_DIR = process.env['PERF_PROFILE_DIR'] ?? resolve(ROOT, 'playwright/perf-profile');
const ONLY = new Set((process.env['PERF_ONLY'] ?? 'startup,search,reader').split(','));

const b64 = (id: string): string => Buffer.from(id).toString('base64url');
const documentRoute = (id: string): string => `#/modules/documents/d/${b64(id)}`;

/** The documents of the reader scenarios: the longest КР, a typical long КР, the longest instruction. */
const DOCUMENTS = [
  {
    key: 'kr-814_1-longest',
    pointer: 'core.catalog.pointer.clinical.kr.rf.814_1-253513f1b96b85c4',
    id: 'kr.rf.814_1',
  },
  {
    key: 'kr-714_2-pneumonia',
    pointer: 'core.catalog.pointer.clinical.kr.rf.714_2-bdda529a738d527d',
    id: 'kr.rf.714_2',
  },
  {
    key: 'instruction-fluconazole-longest',
    pointer: 'core.catalog.pointer.medication.esklp.mnn.флуконазол-80df82de7ccbe18d',
    mnn: 'esklp.mnn.флуконазол',
    id: 'drug.rf.8b56b21a27d668010df1.instruction',
  },
] as const;

const SEARCHES = [
  { key: 'single «пневмония»', scope: 'all', text: 'пневмония' },
  { key: 'single «амоксициллин»', scope: 'all', text: 'амоксициллин' },
  { key: 'multi «боль в груди при дыхании»', scope: 'all', text: 'боль в груди при дыхании' },
  {
    key: 'multi «лечение артериальной гипертензии у детей»',
    scope: 'all',
    text: 'лечение артериальной гипертензии у детей',
  },
  { key: 'section КР «пневмония»', scope: 'guidelines', text: 'пневмония' },
  {
    key: 'section КР «боль в груди при дыхании»',
    scope: 'guidelines',
    text: 'боль в груди при дыхании',
  },
] as const;

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
  await context.addInitScript(installPerfProbes);
  await context.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    window.localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  await routeLocalCatalogModules(context);
  return context;
}

async function throttle(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await cdp.detach();
}

async function waitForCore(page: Page): Promise<void> {
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 600_000, polling: 250 },
  );
}

/** First run only: the core into OPFS, then the reader's modules through their pointers. */
async function ensureInstalled(page: Page, report: Record<string, unknown>): Promise<void> {
  const marker = resolve(PROFILE_DIR, 'perf-installed-v1');
  if (existsSync(marker)) return;
  const started = Date.now();
  await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitForCore(page);
  report['firstRunCoreInstallMs'] = Date.now() - started;
  for (const document of DOCUMENTS) {
    await page.goto(`${E2E_ASSET_ORIGIN}/${documentRoute(document.pointer)}`);
    // An earlier, interrupted setup may have installed it already: the pointer then hands over.
    const action = page.locator('.document-module-pointer__action');
    const offered = await action
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (offered) await action.click();
    const target = 'mnn' in document ? document.mnn : document.id;
    await expect(page).toHaveURL(`${E2E_ASSET_ORIGIN}/${documentRoute(target)}`, {
      timeout: 300_000,
    });
    // A drug pointer installs the group and its instructions in one step (0.6.63).
    await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible({
      timeout: 600_000,
    });
  }
  await page.goto(`${E2E_ASSET_ORIGIN}/${documentRoute(DOCUMENTS[2].id)}`);
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible({
    timeout: 120_000,
  });
  writeFileSync(marker, new Date().toISOString());
}

async function measureStartup(): Promise<Record<string, unknown>> {
  const runs: Record<string, number>[] = [];
  let bytes: Record<string, unknown> = {};
  let startupProfile: readonly string[] = [];
  for (let index = 0; index < REPEATS; index += 1) {
    const context = await openContext();
    const page = context.pages()[0] ?? (await context.newPage());
    await throttle(page, THROTTLE);
    const cdp = index === 0 ? await context.newCDPSession(page) : undefined;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await waitForCore(page);
    await page.waitForTimeout(1500);
    if (cdp) {
      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
      startupProfile = topSelfTime(profile, 30);
      await cdp.detach();
    }
    const run = await page.evaluate(() => {
      const mark = (name: string): number =>
        Math.round(performance.getEntriesByName(name)[0]?.startTime ?? Number.NaN);
      const paint = (name: string): number =>
        Math.round(
          performance.getEntriesByType('paint').find((entry) => entry.name === name)?.startTime ??
            Number.NaN,
        );
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const reveal = performance.getEntriesByName('minimed:boot-reveal')[0]?.startTime ?? 0;
      const ready = performance.getEntriesByName('minimed:search-ready')[0]?.startTime ?? 0;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const scripts = resources.filter(
        (entry) => entry.initiatorType === 'script' || /\.js$/u.test(entry.name),
      );
      const before = (limit: number, list: PerformanceResourceTiming[]): number =>
        Math.round(
          list
            .filter((entry) => entry.responseEnd <= limit)
            .reduce((sum, entry) => sum + entry.decodedBodySize, 0) / 1024,
        );
      const tasks = (
        window as unknown as { __perf: { longTasks: { start: number; duration: number }[] } }
      ).__perf.longTasks;
      const blocking = (limit: number): number =>
        Math.round(
          tasks
            .filter((task) => task.start < limit)
            .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
        );
      return {
        domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd ?? Number.NaN),
        firstContentfulPaintMs: paint('first-contentful-paint'),
        bootRevealMs: mark('minimed:boot-reveal'),
        navigationReadyMs: mark('minimed:navigation-ready'),
        searchReadyMs: mark('minimed:search-ready'),
        jsKBBeforeReveal: before(reveal, scripts),
        jsFilesBeforeReveal: scripts.filter((entry) => entry.responseEnd <= reveal).length,
        cssKBBeforeReveal: before(
          reveal,
          resources.filter((entry) => /\.css$/u.test(entry.name)),
        ),
        jsKBBeforeSearchReady: before(ready, scripts),
        blockingMsBeforeReveal: blocking(reveal),
        blockingMsBeforeSearchReady: blocking(ready),
        longTasksBeforeSearchReady: tasks.filter((task) => task.start < ready).length,
      };
    });
    runs.push(run);
    if (index === 0) {
      bytes = await page.evaluate((reveal) => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return Object.fromEntries(
          resources
            .filter((entry) => /\.js$/u.test(entry.name) && entry.responseEnd <= reveal)
            .toSorted((a, b) => b.decodedBodySize - a.decodedBodySize)
            .slice(0, 12)
            .map((entry) => [
              entry.name.split('/').at(-1) ?? entry.name,
              Math.round(entry.decodedBodySize / 1024),
            ]),
        );
      }, run['bootRevealMs'] ?? 0);
    }
    await context.close();
  }
  const keys = Object.keys(runs[0] ?? {});
  return {
    median: Object.fromEntries(keys.map((key) => [key, median(runs.map((run) => run[key] ?? 0))])),
    runs,
    largestScriptsBeforeRevealKB: bytes,
    topSelfTimeFirstStart: startupProfile,
  };
}

const SEARCH_SELECTORS = [
  '.search-meanings--titles',
  '.results-list .result-group[data-document-id]',
  '.results-skeleton',
  '.search-no-results',
  '[data-testid="search-submit"][aria-busy="true"]',
] as const;
// Final: no skeleton, not busy, a list or the empty state.
const FINAL =
  '(s.flags & 4) === 0 && (s.flags & 16) === 0 && ((s.flags & 2) !== 0 || (s.flags & 8) !== 0)';

async function clearField(page: Page): Promise<void> {
  const input = page.getByTestId('search-input');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1200);
}

async function measureOneSearch(
  page: Page,
  text: string,
  profile: boolean,
): Promise<Record<string, unknown>> {
  await clearField(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await browserMetrics(cdp);
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const from = await startSampling(
    page,
    SEARCH_SELECTORS,
    '.results-list .result-group[data-document-id]',
  );
  // ~11 characters a second: a doctor typing on a phone.
  await page.keyboard.type(text, { delay: 90 });
  await waitForSettled(page, FINAL, 1500, 120_000);
  const window = await stopSampling(page, from);
  const after = await browserMetrics(cdp);
  const searchProfile = profile
    ? ((await cdp.send('Profiler.stop')) as { profile: CpuProfile }).profile
    : undefined;
  const topSelf = searchProfile ? topSelfTime(searchProfile, 20) : undefined;
  await cdp.detach();
  const firstKey = window.keys[0] ?? from;
  const lastKey = window.keys.at(-1) ?? from;
  const afterKeys = window.samples.filter((sample) => sample.t >= lastKey);
  const firstResult = afterKeys.find((sample) => (sample.flags & 3) !== 0);
  const finalFrame = afterKeys.find((sample) =>
    (new Function('s', `return (${FINAL});`) as (s: unknown) => boolean)(sample),
  );
  // The list grows progressively: the frame its final group count first showed.
  const finalCount = afterKeys.at(-1)?.count ?? 0;
  const fullList = afterKeys.find(
    (sample) => sample.count === finalCount && (sample.flags & 4) === 0,
  );
  const endOfSearch = Math.max(finalFrame?.t ?? lastKey, fullList?.t ?? lastKey);
  return {
    firstResultMs: firstResult ? Math.round(firstResult.t - lastKey) : null,
    titleMatchesMs: (() => {
      const hit = afterKeys.find((sample) => (sample.flags & 1) !== 0);
      return hit ? Math.round(hit.t - lastKey) : null;
    })(),
    finalMs: finalFrame ? Math.round(endOfSearch - lastKey) : null,
    groups: finalCount,
    typingLongTasks: longTaskSummary(window.longTasks, firstKey, lastKey),
    searchLongTasks: longTaskSummary(window.longTasks, lastKey, endOfSearch),
    workerCalls: workerCallSummary(window.calls),
    browser: metricsDelta(before, after),
    timelineAfterLastKey: flagTimeline(afterKeys, lastKey),
    marksAfterLastKey: await page.evaluate(
      (from) =>
        performance
          .getEntriesByType('mark')
          .filter((mark) => mark.name.startsWith('minimed:search:') && mark.startTime >= from)
          .map(
            (mark) =>
              `${String(Math.round(mark.startTime - from))}: ${mark.name.replace('minimed:search:', '')}`,
          ),
      lastKey,
    ),
    ...(topSelf ? { topSelfTime: topSelf } : {}),
    ...(searchProfile ? { nativeCallers: nativeCallers(searchProfile) } : {}),
  };
}

async function measureSearch(): Promise<Record<string, unknown>> {
  const context = await openContext();
  // Saved answers of earlier runs would make every «first» a cache read: start without them.
  await context.addInitScript(() => {
    indexedDB.deleteDatabase('minimed-search-results');
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const out: Record<string, unknown> = {};
  await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitForCore(page);
  await page.getByTestId('search-input').waitFor();
  await page.waitForTimeout(3000);
  await throttle(page, THROTTLE);
  let scope = 'all';
  for (const [index, search] of SEARCHES.entries()) {
    if (search.scope !== scope) {
      await page.goto(`${E2E_ASSET_ORIGIN}/#/search/section/${search.scope}`);
      await page.getByTestId('search-input').waitFor();
      await page.waitForTimeout(2000);
      scope = search.scope;
    }
    const cold = await measureOneSearch(page, search.text, index === 0 || index === 3);
    const warm = await measureOneSearch(page, search.text, false);
    out[search.key] = { [index === 0 ? 'firstAfterStart' : 'first']: cold, repeat: warm };
  }
  await context.close();
  return out;
}

const READER_SELECTORS = [
  '.document-overlay-section__paragraph',
  '.same-title-documents',
  '.document-page__body',
] as const;

async function measureOpen(
  page: Page,
  id: string,
  profile: boolean,
): Promise<Record<string, unknown>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await browserMetrics(cdp);
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const from = await startSampling(page, READER_SELECTORS, '.document-overlay-section');
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, documentRoute(id));
  // Mounted: the section count has not changed for 2 s (slices finished).
  await page.waitForFunction(
    () => {
      const samples = (
        window as unknown as { __perf: { samples: { t: number; flags: number; count: number }[] } }
      ).__perf.samples;
      const last = samples.at(-1);
      if (!last || (last.flags & 1) === 0) return false;
      let index = samples.length - 1;
      while (index > 0 && samples[index - 1]?.count === last.count) index -= 1;
      return last.t - (samples[index]?.t ?? last.t) >= 2000;
    },
    undefined,
    { timeout: 300_000, polling: 200 },
  );
  const window = await stopSampling(page, from);
  const after = await browserMetrics(cdp);
  const openProfile = profile
    ? ((await cdp.send('Profiler.stop')) as { profile: CpuProfile }).profile
    : undefined;
  const topSelf = openProfile ? topSelfTime(openProfile, 25) : undefined;
  await cdp.detach();
  const firstText = window.samples.find((sample) => (sample.flags & 1) !== 0);
  const finalCount = window.samples.at(-1)?.count ?? 0;
  const mounted = window.samples.find((sample) => sample.count === finalCount);
  const otherChips = window.samples.find((sample) => (sample.flags & 2) !== 0);
  const mountedAt = mounted?.t ?? from;
  const tasks = window.longTasks.filter((task) => task.start >= from);
  const lastTaskEnd = Math.max(mountedAt, ...tasks.map((task) => task.start + task.duration));
  return {
    firstTextMs: firstText ? Math.round(firstText.t - from) : null,
    allSectionsMountedMs: Math.round(mountedAt - from),
    // Interactive: every section mounted and the last long task of the open is over.
    interactiveMs: Math.round(lastTaskEnd - from),
    otherChipsMs: otherChips ? Math.round(otherChips.t - from) : null,
    sections: finalCount,
    longTasks: longTaskSummary(tasks, from, lastTaskEnd + 1),
    workerCalls: workerCallSummary(window.calls),
    browser: metricsDelta(before, after),
    ...(topSelf ? { topSelfTime: topSelf } : {}),
    ...(openProfile ? { nativeCallers: nativeCallers(openProfile) } : {}),
  };
}

async function measureScroll(page: Page, profile: boolean): Promise<Record<string, unknown>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const out: Record<string, unknown> = {};
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(800);
  let before = await browserMetrics(cdp);
  let from = await page.evaluate(() => performance.now());
  let start = await frameCount(page);
  // Reading: ~1 800 px/s (30 px a frame) for 240 frames.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 240; frame += 1) {
      window.scrollBy({ top: 30, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  let to = await page.evaluate(() => performance.now());
  const longTasksOf = async (a: number, b: number) =>
    longTaskSummary(
      await page.evaluate(
        () =>
          (window as unknown as { __perf: { longTasks: { start: number; duration: number }[] } })
            .__perf.longTasks,
      ),
      a,
      b,
    );
  out['read'] = {
    ...(await frameStats(page, start)),
    longTasks: await longTasksOf(from, to),
    browser: metricsDelta(before, await browserMetrics(cdp)),
  };
  // Fling to the end: 160 px a frame.
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  before = await browserMetrics(cdp);
  from = to;
  start = await frameCount(page);
  await page.evaluate(async () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    for (let y = window.scrollY; y < total; y += 160) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  to = await page.evaluate(() => performance.now());
  out['fling'] = {
    ...(await frameStats(page, start)),
    longTasks: await longTasksOf(from, to),
    browser: metricsDelta(before, await browserMetrics(cdp)),
  };
  if (profile) {
    const { profile: flingProfile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
    out['flingTopSelfTime'] = topSelfTime(flingProfile, 20);
    out['flingNativeCallers'] = nativeCallers(flingProfile);
  }
  out['scrollHeightPx'] = await page.evaluate(() => document.documentElement.scrollHeight);
  await cdp.detach();
  return out;
}

async function measureContents(page: Page): Promise<Record<string, unknown>> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1000);
  const toggle = page.locator('.document-overlay-outline-toggle').first();
  if (!(await toggle.isVisible().catch(() => false))) return { available: false };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await browserMetrics(cdp);
  const from = await startSampling(page, ['.document-overlay-outline-section-button']);
  await toggle.click();
  await waitForSettled(page, '(s.flags & 1) !== 0', 500, 60_000);
  const window = await stopSampling(page, from);
  const shown = window.samples.find((sample) => (sample.flags & 1) !== 0);
  const items = page.locator('.document-overlay-outline-section-button');
  const count = await items.count();
  // Jump to the middle of the document.
  const jumpFrom = await startSampling(page, []);
  await items.nth(Math.floor(count / 2)).click();
  await page.waitForTimeout(2000);
  const jump = await stopSampling(page, jumpFrom);
  const after = await browserMetrics(cdp);
  await cdp.detach();
  return {
    openMs: shown ? Math.round(shown.t - from) : null,
    openLongTasks: longTaskSummary(window.longTasks, from, shown?.t ?? from + 1),
    items: count,
    jumpLongTasks: longTaskSummary(jump.longTasks, jumpFrom, jumpFrom + 2000),
    browser: metricsDelta(before, after),
  };
}

async function measureReader(): Promise<Record<string, unknown>> {
  const context = await openContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const out: Record<string, unknown> = {};
  await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitForCore(page);
  await page.waitForTimeout(3000);
  await throttle(page, THROTTLE);
  for (const [index, document] of DOCUMENTS.entries()) {
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.waitForTimeout(2500);
    const home = await page.context().newCDPSession(page);
    await home.send('HeapProfiler.collectGarbage');
    await home.send('Performance.enable');
    const homeMetrics = await browserMetrics(home);
    await home.detach();
    const open = await measureOpen(page, document.id, index === 0);
    const scroll = await measureScroll(page, index === 0);
    const contents = await measureContents(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable');
    const settled = await browserMetrics(cdp);
    const dom = (await cdp.send('Memory.getDOMCounters')) as {
      documents: number;
      nodes: number;
      jsEventListeners: number;
    };
    await cdp.detach();
    // Reopen: back to the start page, then the same document again.
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.waitForTimeout(2500);
    const reopen = await measureOpen(page, document.id, false);
    out[document.key] = {
      open,
      scroll,
      contents,
      memoryAfterGc: {
        heapMB: Math.round(settled.JSHeapUsedSize / 1e5) / 10,
        heapMBOnStartPageBefore: Math.round(homeMetrics.JSHeapUsedSize / 1e5) / 10,
        domNodesOnStartPageBefore: homeMetrics.Nodes,
        domNodes: dom.nodes,
        listeners: dom.jsEventListeners,
      },
      reopen,
    };
  }
  await context.close();
  return out;
}

test('perf baseline: start-up, search, reader on a throttled phone', async () => {
  test.setTimeout(3_600_000);
  const report: Record<string, unknown> = {
    when: new Date().toISOString(),
    throttle: `${String(THROTTLE)}x CPU`,
    viewport: '390x844@2.75 touch',
    repeats: REPEATS,
  };
  {
    const context = await openContext();
    const page = context.pages()[0] ?? (await context.newPage());
    await ensureInstalled(page, report);
    await context.close();
  }
  if (ONLY.has('startup')) report['startup'] = await measureStartup();
  if (ONLY.has('search')) report['search'] = await measureSearch();
  if (ONLY.has('reader')) report['reader'] = await measureReader();
  const out =
    process.env['PERF_OUT'] ??
    resolve(ROOT, `playwright/perf-${new Date().toISOString().replaceAll(':', '-')}.json`);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`perf report: ${out}`);
});
