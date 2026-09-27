// Measures the knowledge-graph dialog on a served production build (not the e2e port):
//   bun run --cwd apps/app preview -- --host 127.0.0.1 --port 4180 --strictPort
//   node scripts/measure-knowledge-graph.mjs http://127.0.0.1:4180 [width] [height] [runs] [--headed]
// Reports time to first canvas draw, main-thread long tasks while the layout settles, and frame
// rate and frame times while panning and zooming. Headless Chromium paces rAF at 60 Hz, so its FPS
// is capped; --headed opens a window at the top-left of the main display with vsync and the frame
// rate limit disabled, so the interval of every frame that redrew the graph is its real cost.
// Frame budgets: 8.3 ms for 120 Hz, 6.1 ms for 165 Hz. Numbers are this machine, not a device.
import { chromium } from '@playwright/test';

const headed = process.argv.includes('--headed');
const positional = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const origin = positional[0] ?? 'http://127.0.0.1:4180';
const width = Number(positional[1] ?? 1280);
const height = Number(positional[2] ?? 844);
const runs = Number(positional[3] ?? 1);
const scenarios = [
  { name: 'Нормативные документы', section: 'Нормативные документы' },
  // An ATC group with 250–480 documents: the largest graphs that still run the force layout.
  { name: 'Подраздел 250–480', section: 'Препараты', subgroup: [250, 480] },
  { name: 'Клинические рекомендации', section: 'Клинические рекомендации' },
  { name: 'Все источники', section: 'Все источники' },
  // The explicit «Показать все» action: the whole subgroup (force layout) and every source (grid).
  { name: 'Подраздел 250–480, все', section: 'Препараты', subgroup: [250, 480], showAll: true },
  { name: 'Все источники, все', section: 'Все источники', showAll: true },
];

async function openSection(page, section, subgroup) {
  await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
  if (!subgroup) {
    await page
      .locator('.search-section-menu__row')
      .getByRole('button', { name: new RegExp(`^${section}(?: \\(|$)`, 'u') })
      .click();
    await page.keyboard.press('Escape');
    return null;
  }
  const expand = page.getByRole('button', { name: `Подразделы: ${section}`, exact: true });
  // The menu reopens with the selected section already expanded; clicking again would collapse it.
  if ((await expand.getAttribute('aria-expanded')) !== 'true') await expand.click();
  const labels = await page
    .locator('.search-section-menu__option--child')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
  const label = labels.find((value) => {
    const count = Number(/\((\d+)\)$/u.exec(value)?.[1] ?? 0);
    return count >= subgroup[0] && count <= subgroup[1];
  });
  if (!label)
    throw new Error(`No subgroup between ${subgroup[0]} and ${subgroup[1]}: ${labels.join('; ')}`);
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
  return label;
}

// Opens the default graph and returns the «Показать все» selector; builds without the action
// already draw the whole scope, so they are measured from the graph button instead.
async function prepareShowAll(page) {
  // Older builds keep the search-bar button visually hidden, so click it through the DOM.
  await page.evaluate(() => document.querySelector('.search-graph-button').click());
  await page.locator('.knowledge-graph-card').waitFor();
  if (await page.locator('.knowledge-graph-card__show-all').count())
    return '.knowledge-graph-card__show-all';
  await page.keyboard.press('Escape');
  return '.search-graph-button';
}

async function measure(page, scenario) {
  const picked = await openSection(page, scenario.section, scenario.subgroup);
  await page.waitForFunction(() => {
    const button = document.querySelector('.search-graph-button');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const trigger = scenario.showAll ? await prepareShowAll(page) : '.search-graph-button';
  const opened = await page.evaluate(async (triggerSelector) => {
    const longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    let firstDraw = null;
    const original = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function patched(...args) {
      if (firstDraw === null && this.canvas.classList.contains('knowledge-graph-canvas'))
        firstDraw = performance.now();
      return original.apply(this, args);
    };
    const start = performance.now();
    document.querySelector(triggerSelector).click();
    // First frame showing laid-out nodes: builds without a layout state draw them immediately.
    const laidOut = () => {
      const card = document.querySelector('.knowledge-graph-card');
      const state = card?.getAttribute('data-layout-state');
      return firstDraw !== null && (state === null || state === undefined || state !== 'pending');
    };
    while (!laidOut() && performance.now() - start < 30_000)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const firstFrame = performance.now() - start;
    // Let the layout settle; long tasks here block input.
    let settled = null;
    while (performance.now() - start < firstFrame + 4000) {
      const state = document
        .querySelector('.knowledge-graph-card')
        ?.getAttribute('data-layout-state');
      if (settled === null && (state === 'settled' || !state)) settled = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    observer.disconnect();
    CanvasRenderingContext2D.prototype.fillRect = original;
    return {
      firstDrawMs: firstDraw === null ? null : Math.round(firstDraw - start),
      firstFrameMs: Math.round(firstFrame),
      settledMs: settled === null ? null : Math.round(settled),
      longTasks: longTasks.length,
      longestTaskMs: Math.round(Math.max(0, ...longTasks)),
      longTaskTotalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
    };
  }, trigger);
  const canvas = page.locator('.knowledge-graph-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Graph canvas is not visible.');
  const nodeCount = await page.evaluate(() =>
    document.querySelector('.knowledge-graph-card')?.getAttribute('data-node-count'),
  );
  const frames = async (interaction) => {
    await page.evaluate(() => {
      const graphCanvas = (context) => context.canvas.classList.contains('knowledge-graph-canvas');
      const state = { times: [], drawnGaps: [], drawMs: [], drew: false, drawStart: null };
      window.__graphFrames = state;
      const fillRect = CanvasRenderingContext2D.prototype.fillRect;
      const restore = CanvasRenderingContext2D.prototype.restore;
      // draw() opens with a full-canvas fill and closes with restore().
      CanvasRenderingContext2D.prototype.fillRect = function patched(...args) {
        if (graphCanvas(this) && args[0] === 0 && args[1] === 0)
          state.drawStart = performance.now();
        return fillRect.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.restore = function patched() {
        if (graphCanvas(this) && state.drawStart !== null) {
          state.drawMs.push(performance.now() - state.drawStart);
          state.drawStart = null;
          state.drew = true;
        }
        return restore.call(this);
      };
      state.unpatch = () => {
        CanvasRenderingContext2D.prototype.fillRect = fillRect;
        CanvasRenderingContext2D.prototype.restore = restore;
      };
      const tick = (time) => {
        const previous = state.times.at(-1);
        // Only frames that redrew the graph: idle frames between synthetic inputs cost nothing.
        if (previous !== undefined && state.drew) state.drawnGaps.push(time - previous);
        state.drew = false;
        state.times.push(time);
        if (state.times.length < 200000) state.frameId = requestAnimationFrame(tick);
      };
      state.frameId = requestAnimationFrame(tick);
    });
    const started = Date.now();
    await interaction();
    const elapsed = Date.now() - started;
    return page.evaluate((elapsedMs) => {
      const state = window.__graphFrames;
      cancelAnimationFrame(state.frameId);
      state.unpatch();
      const sorted = (values) => values.toSorted((a, b) => a - b);
      const quantile = (values, q) =>
        values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : null;
      const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
      const gaps = sorted(state.drawnGaps);
      const draws = sorted(state.drawMs);
      const share = (limit) =>
        gaps.length
          ? Math.round((gaps.filter((gap) => gap > limit).length / gaps.length) * 100)
          : null;
      return {
        fps: Math.round((state.times.length / elapsedMs) * 1000),
        drawnFrames: gaps.length,
        frameMedianMs: round(quantile(gaps, 0.5)),
        frameP95Ms: round(quantile(gaps, 0.95)),
        worstFrameMs: round(gaps.at(-1) ?? null),
        over120HzPct: share(8.3),
        over165HzPct: share(6.1),
        drawMedianMs: round(quantile(draws, 0.5)),
        drawP95Ms: round(quantile(draws, 0.95)),
      };
    }, elapsed);
  };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Press in the empty top-left corner: pressing on a node would drag it instead of panning.
  const px = box.x + 8;
  const py = box.y + 8;
  const pressTarget = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.className ?? '',
    [px, py],
  );
  if (!String(pressTarget).includes('knowledge-graph-canvas'))
    throw new Error(`Pan start is covered by ${pressTarget}`);
  const pan = await frames(async () => {
    await page.mouse.move(px, py);
    await page.mouse.down();
    for (let step = 0; step < 120; step += 1) {
      await page.mouse.move(
        px + (1 - Math.cos(step / 10)) * 120,
        py + Math.sin(step / 10) * 80 + 80,
      );
    }
    await page.mouse.up();
  });
  const zoom = await frames(async () => {
    await page.mouse.move(cx, cy);
    for (let step = 0; step < 40; step += 1) await page.mouse.wheel(0, step < 20 ? -120 : 120);
  });
  await page.keyboard.press('Escape');
  const name = picked ? `${picked}${scenario.showAll ? ', все' : ''}` : scenario.name;
  return { scenario: name, nodeCount, ...opened, pan, zoom };
}

const browser = await chromium.launch(
  headed
    ? {
        headless: false,
        args: [
          '--window-position=0,0',
          `--window-size=${width},${height + 90}`,
          '--disable-frame-rate-limit',
          '--disable-gpu-vsync',
        ],
      }
    : {},
);
// Headed runs keep the window's real device pixel ratio.
const page = await browser.newPage(headed ? { viewport: null } : { viewport: { width, height } });
await page.addInitScript(() => {
  localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
});
await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
await page.getByTestId('search-input').waitFor({ timeout: 120_000 });
const median = (values) => {
  const sorted = values.filter((value) => typeof value === 'number').toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const medianStats = (stats) =>
  Object.fromEntries(
    Object.keys(stats[0] ?? {}).map((key) => [key, median(stats.map((entry) => entry[key]))]),
  );
const results = [];
for (const scenario of scenarios) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) samples.push(await measure(page, scenario));
  const first = samples[0];
  results.push({
    scenario: first.scenario,
    nodeCount: first.nodeCount,
    runs,
    firstFrameMs: median(samples.map((sample) => sample.firstFrameMs)),
    settledMs: median(samples.map((sample) => sample.settledMs)),
    longTasks: median(samples.map((sample) => sample.longTasks)),
    longestTaskMs: median(samples.map((sample) => sample.longestTaskMs)),
    pan: medianStats(samples.map((sample) => sample.pan)),
    zoom: medianStats(samples.map((sample) => sample.zoom)),
  });
}
const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
console.log(
  JSON.stringify({ viewport: `${width}x${height}`, headed, devicePixelRatio, results }, null, 2),
);
await browser.close();
