import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticPdf } from './synthetic-pdf';

/**
 * Phone-performance measurement of the shared PDF viewer, not a regression gate: run it against a
 * production build with `PDF_PERF=1`. It opens a 150-page text-dense PDF in a 390 px, 2.75× device
 * with the CPU throttled 4×, then scrolls, jumps, searches, zooms and opens the thumbnails while
 * sampling frame times, long tasks, live canvases, canvas pixels and the JS heap.
 */
test.skip(!process.env['PDF_PERF'], 'phone-performance measurement; run with PDF_PERF=1');

const PAGES = 150;
const THROTTLE = Number(process.env['PDF_PERF_THROTTLE'] ?? '4');

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2.75,
  hasTouch: true,
});

function denseLines(pageIndex: number): readonly string[] {
  // 38 lines of ~70 characters fit an A4 page set in 12 pt Helvetica with the fixture's spacing.
  const lines = [
    `Chapter ${String(Math.ceil((pageIndex + 1) / 10))} page ${String(pageIndex + 1)}`,
  ];
  for (let line = 0; line < 38; line += 1) {
    const marker = pageIndex % 7 === 0 && line === 5 ? ' hypertension in adults' : '';
    lines.push(
      `Line ${String(line)} page ${String(pageIndex + 1)} routine follow-up notes${marker} end.`,
    );
  }
  return lines;
}

interface Sample {
  readonly canvases: number;
  readonly canvasMegapixels: number;
  readonly heapMb: number;
}

async function sample(page: Page): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  // Collect first: the figure is what the viewer retains, not garbage waiting for a sweep.
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const heap = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
  const canvases = await page.evaluate(() => {
    let pixels = 0;
    const list = document.querySelectorAll<HTMLCanvasElement>(
      '.pdf-viewer__canvas, .pdf-thumbnails__canvas',
    );
    for (const canvas of list) pixels += canvas.width * canvas.height;
    return { count: list.length, pixels };
  });
  return {
    canvases: canvases.count,
    canvasMegapixels: Math.round(canvases.pixels / 10_000) / 100,
    heapMb: Math.round(heap / 1024 / 1024),
  };
}

async function frameStats(page: Page, from: number): Promise<Record<string, number>> {
  return page.evaluate((start) => {
    const state = window as unknown as {
      __frames: number[];
      __longTasks: number[];
      __seenPages: Set<string>;
      __peakCanvases: number;
      __peakMegapixels: number;
    };
    const frames = state.__frames.slice(start).toSorted((a, b) => a - b);
    const at = (fraction: number): number => frames[Math.floor(frames.length * fraction)] ?? 0;
    return {
      frames: frames.length,
      frameMsP50: Math.round(at(0.5)),
      frameMsP95: Math.round(at(0.95)),
      frameMsMax: Math.round(frames.at(-1) ?? 0),
      framesOver50ms: frames.filter((value) => value > 50).length,
      framesOver100ms: frames.filter((value) => value > 100).length,
      longTasksSoFar: state.__longTasks.length,
      longTaskMaxMsSoFar: Math.round(Math.max(0, ...state.__longTasks)),
      pagesEverDrawnSoFar: state.__seenPages.size,
      peakLiveCanvasesSoFar: state.__peakCanvases,
      peakCanvasMegapixelsSoFar: Math.round(state.__peakMegapixels * 100) / 100,
    };
  }, from);
}

test('150-page PDF on a throttled phone', async ({ page }) => {
  test.setTimeout(600_000);
  const report: Record<string, unknown> = { pages: PAGES, throttle: `${String(THROTTLE)}x CPU` };
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  const pdf = syntheticPdf({ pages: PAGES, lines: denseLines });
  report['fileKb'] = Math.round(pdf.length / 1024);
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: 'perf-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  const card = page.locator('.user-library-card').filter({ hasText: 'perf-fixture' });
  await card.first().waitFor();
  await expect(card.first()).toContainText('Текстовый слой найден', { timeout: 120_000 });

  // Everything below runs with the CPU slowed down.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.evaluate(() => {
    const state = window as unknown as {
      __longTasks: number[];
      __frames: number[];
      __seenPages: Set<string>;
      __peakCanvases: number;
      __peakMegapixels: number;
    };
    state.__longTasks = [];
    state.__frames = [];
    state.__seenPages = new Set();
    state.__peakCanvases = 0;
    state.__peakMegapixels = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.__longTasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = (now: number): void => {
      state.__frames.push(now - last);
      last = now;
      let pixels = 0;
      let count = 0;
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.pdf-viewer__canvas')) {
        count += 1;
        pixels += canvas.width * canvas.height;
        const host = canvas.closest('[data-pdf-page]');
        if (host) state.__seenPages.add(host.getAttribute('data-pdf-page') ?? '');
      }
      state.__peakCanvases = Math.max(state.__peakCanvases, count);
      state.__peakMegapixels = Math.max(state.__peakMegapixels, pixels / 1_000_000);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // 1. Open: from the tap to the first drawn page with a text layer.
  const opened = Date.now();
  await card.first().click();
  await page.locator('.pdf-viewer__canvas').first().waitFor();
  await page.locator('.pdf-viewer__text-run').first().waitFor();
  report['openToFirstPageMs'] = Date.now() - opened;
  report['afterOpen'] = await sample(page);

  // 2a. Read on: a finger-speed scroll (~1 800 px/s) through the first pages.
  const frameStart = await page.evaluate(
    () => (window as unknown as { __frames: number[] }).__frames.length,
  );
  const readStarted = Date.now();
  await page.evaluate(async () => {
    for (let frame = 0; frame < 140; frame += 1) {
      window.scrollBy({ top: 30, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  report['readScrollMs'] = Date.now() - readStarted;
  report['readScroll'] = await frameStats(page, frameStart);
  const readSettled = Date.now();
  await page.waitForFunction(() => {
    const centre = window.innerHeight / 2;
    for (const host of document.querySelectorAll('[data-pdf-page]')) {
      const rect = host.getBoundingClientRect();
      if (rect.top <= centre && rect.bottom >= centre) {
        return Boolean(host.querySelector('.pdf-viewer__canvas'));
      }
    }
    return false;
  });
  report['readScrollToPageDrawnMs'] = Date.now() - readSettled;
  report['afterReadScroll'] = await sample(page);

  // 2b. Fling through the whole document (160 px per frame): renders must be cancelled, not queued.
  const flingFrames = await page.evaluate(
    () => (window as unknown as { __frames: number[] }).__frames.length,
  );
  const flingStarted = Date.now();
  await page.evaluate(async () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    for (let y = window.scrollY; y < total; y += 160) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  report['flingMs'] = Date.now() - flingStarted;
  report['fling'] = await frameStats(page, flingFrames);
  await page.waitForTimeout(2000);
  report['afterFling'] = await sample(page);
  report['pageRenders'] = await page.evaluate(() => {
    const durations = performance
      .getEntriesByName('pdf-page-render')
      .map((entry) => entry.duration)
      .toSorted((a, b) => a - b);
    const at = (fraction: number): number =>
      durations[Math.floor(durations.length * fraction)] ?? 0;
    return {
      count: durations.length,
      msP50: Math.round(at(0.5)),
      msP95: Math.round(at(0.95)),
      msMax: Math.round(durations.at(-1) ?? 0),
    };
  });

  // 3. Jump to a far page.
  const jumped = Date.now();
  await page.getByRole('textbox', { name: 'Номер страницы' }).fill('140');
  await page.getByRole('textbox', { name: 'Номер страницы' }).press('Enter');
  await expect
    .poll(() => page.getByRole('textbox', { name: 'Номер страницы' }).inputValue())
    .toBe('140');
  await page.locator('[data-pdf-page="139"] .pdf-viewer__canvas').waitFor();
  report['goToPageToDrawnMs'] = Date.now() - jumped;
  report['heapAfterGoToMb'] = (await sample(page)).heapMb;

  // 4. Find: from typing to the count; the text of all pages is read first.
  await page.getByRole('button', { name: 'Поиск в документе' }).click();
  const searched = Date.now();
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).fill('hypertension in adults');
  await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d+$/u, {
    timeout: 120_000,
  });
  report['firstSearchMs'] = Date.now() - searched;
  report['matches'] = await page.locator('.document-find__count').innerText();
  report['heapAfterFirstSearchMb'] = (await sample(page)).heapMb;
  const second = Date.now();
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).fill('routine follow-up notes');
  // Every page matches (several thousand hits), so the count has three digits at least.
  await expect(page.locator('.document-find__count')).toHaveText(/^1\/\d{3,}$/u);
  report['secondSearchMs'] = Date.now() - second;
  report['heapAfterSecondSearchMb'] = (await sample(page)).heapMb;
  const stepped = Date.now();
  await page.getByRole('button', { name: 'Следующее совпадение' }).click();
  await expect(page.locator('.document-find__count')).toHaveText(/^2\/\d+$/u);
  report['stepToNextMatchMs'] = Date.now() - stepped;
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).press('Escape');

  // 5. Zoom in: the visible page is drawn again at the larger size.
  const widthBefore = await page
    .locator('.pdf-viewer__canvas')
    .first()
    .evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  const zoomed = Date.now();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect
    .poll(
      () =>
        page
          .locator('.pdf-viewer__canvas')
          .first()
          .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(widthBefore * 1.3);
  report['zoomToSharpMs'] = Date.now() - zoomed;
  report['afterZoom'] = await sample(page);
  await page.getByRole('button', { name: 'Уменьшить' }).click();
  await page.getByRole('button', { name: 'Уменьшить' }).click();

  // 6. Thumbnails: scroll the whole strip; the memory cap must hold.
  await page.getByRole('button', { name: 'Открыть оглавление' }).click();
  await page.locator('.pdf-thumbnails__item').first().waitFor();
  const thumbs = await page.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('.pdf-thumbnails');
    if (!list) return { peakDrawn: 0, peakMegapixels: 0 };
    let scroller: HTMLElement | null = list;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1)) {
      scroller = scroller.parentElement;
    }
    const target = scroller ?? document.documentElement;
    let peakDrawn = 0;
    let peakMegapixels = 0;
    const measure = (): void => {
      let drawn = 0;
      let pixels = 0;
      for (const canvas of list.querySelectorAll<HTMLCanvasElement>('canvas')) {
        if (canvas.width > 1) {
          drawn += 1;
          pixels += canvas.width * canvas.height;
        }
      }
      peakDrawn = Math.max(peakDrawn, drawn);
      peakMegapixels = Math.max(peakMegapixels, pixels / 1_000_000);
    };
    for (let y = 0; y < target.scrollHeight; y += 200) {
      target.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
      measure();
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    measure();
    return { peakDrawn, peakMegapixels: Math.round(peakMegapixels * 100) / 100 };
  });
  report['thumbnails'] = thumbs;
  report['afterThumbnails'] = await sample(page);

  console.log(`PDF_PERF_RESULT ${JSON.stringify(report, null, 2)}`);
});
