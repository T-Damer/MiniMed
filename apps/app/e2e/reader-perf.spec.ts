import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import {
  installClinicalModule,
  PNEUMONIA_CHILDREN_TARGET,
  routeClinicalModule,
} from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

/**
 * Phone-performance measurement of the document reader, not a regression gate: run it against a
 * production build with `READER_PERF=1` (optionally `READER_PERF_OUT=<file.json>`). It opens a long
 * clinical recommendation in a 390 px, 2.75× device with the CPU throttled 4×, scrolls through it at
 * finger speed and with a fling, opens and scrolls the contents, and records frame times, long tasks
 * and a CPU profile summed by function (self time), so a regression names its cause.
 */
test.skip(!process.env['READER_PERF'], 'phone-performance measurement; run with READER_PERF=1');

const THROTTLE = Number(process.env['READER_PERF_THROTTLE'] ?? '4');

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2.75,
  hasTouch: true,
});

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

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

function topSelfTime(profile: CpuProfile, limit = 30): readonly string[] {
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

/** Who calls the costliest built-in functions (layout reads, animation lookups): the nearest script frame. */
function nativeCallers(profile: CpuProfile, names: readonly string[]): readonly string[] {
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
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
    const key = `${node.callFrame.functionName} ← ${chain.join(' ← ')}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...totals.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`);
}

async function frameStats(page: Page, from: number): Promise<Record<string, number>> {
  return page.evaluate((start) => {
    const state = window as unknown as { __frames: number[]; __longTasks: number[] };
    const frames = state.__frames.slice(start).toSorted((a, b) => a - b);
    const at = (fraction: number): number => frames[Math.floor(frames.length * fraction)] ?? 0;
    return {
      frames: frames.length,
      frameMsP50: Math.round(at(0.5)),
      frameMsP95: Math.round(at(0.95)),
      frameMsMax: Math.round(frames.at(-1) ?? 0),
      framesOver50ms: frames.filter((value) => value > 50).length,
      longTasks: state.__longTasks.length,
      longTaskMaxMs: Math.round(Math.max(0, ...state.__longTasks)),
    };
  }, from);
}

async function frameCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __frames: number[] }).__frames.length);
}

test('long clinical recommendation on a throttled phone', async ({ page }) => {
  test.setTimeout(600_000);
  const report: Record<string, unknown> = { throttle: `${String(THROTTLE)}x CPU` };
  await routeClinicalModule(page, PNEUMONIA_CHILDREN_TARGET);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await installClinicalModule(page, PNEUMONIA_CHILDREN_TARGET);
  await expect(page.locator('.document-page__body')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.evaluate(() => {
    const state = window as unknown as { __longTasks: number[]; __frames: number[] };
    state.__longTasks = [];
    state.__frames = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.__longTasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = (now: number): void => {
      state.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');

  // Read on: ~1 800 px/s (30 px per frame) for 240 frames.
  let start = await frameCount(page);
  await page.evaluate(async () => {
    for (let frame = 0; frame < 240; frame += 1) {
      window.scrollBy({ top: 30, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  report['readScroll'] = await frameStats(page, start);

  // Back up a little (the controls come back), then fling to the end.
  start = await frameCount(page);
  await page.evaluate(async () => {
    for (let frame = 0; frame < 40; frame += 1) {
      window.scrollBy({ top: -20, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    const total = document.documentElement.scrollHeight - window.innerHeight;
    for (let y = window.scrollY; y < total; y += 160) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  report['fling'] = await frameStats(page, start);
  await page.waitForTimeout(1500);

  // The contents: open, scroll the list, jump to a section in the middle.
  start = await frameCount(page);
  await page.locator('.document-overlay-outline-toggle').first().click();
  const items = page.locator('.document-overlay-outline-section-button');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  await items.nth(Math.floor(count / 2)).click();
  await page.waitForTimeout(1500);
  report['contentsJump'] = await frameStats(page, start);
  report['contentsItems'] = count;

  const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
  report['topSelfTime'] = topSelfTime(profile);
  report['nativeCallers'] = nativeCallers(profile, [
    'getAnimations',
    'getBoundingClientRect',
    'getClientRects',
    'querySelector',
    'elementFromPoint',
  ]);
  report['scrollHeight'] = await page.evaluate(() => document.documentElement.scrollHeight);
  report['domNodes'] = await page.evaluate(() => document.getElementsByTagName('*').length);
  const out = process.env['READER_PERF_OUT'];
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
});
