import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { setClinicalAnalysis } from '@localmed/app/e2e/select-search-section';
import { expect, type Page, test } from '@playwright/test';

const QUERY = 'пневмония у детей';

interface SlotSample {
  readonly skeleton: number | undefined;
  readonly skeletonOpacity: number;
  readonly results: number | undefined;
}

/** Below this the skeleton is still the first, fully transparent frames of its fade-in. */
const VISIBLE_OPACITY = 0.05;

async function waitForSearchReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );
}

/** Samples the skeleton's and the results' document-relative tops on every animation frame. */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: {
      skeleton: number | undefined;
      skeletonOpacity: number;
      results: number | undefined;
    }[] = [];
    const top = (selector: string): number | undefined => {
      const element = document.querySelector(selector);
      return element ? element.getBoundingClientRect().top + window.scrollY : undefined;
    };
    const frame = (): void => {
      samples.push({
        skeleton: top('[data-testid="search-skeleton"]'),
        skeletonOpacity: Number(
          getComputedStyle(
            document.querySelector('[data-testid="search-skeleton"]') ?? document.body,
          ).opacity,
        ),
        // The definition card, when the query has one, opens the results above the list.
        results: top('.definition-preview, [data-testid="search-results"]'),
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    (window as unknown as { __slotSamples: typeof samples }).__slotSamples = samples;
  });
}

async function readSamples(page: Page): Promise<readonly SlotSample[]> {
  return page.evaluate(() =>
    (window as unknown as { __slotSamples: SlotSample[] }).__slotSamples.slice(),
  );
}

for (const clinical of [false, true]) {
  for (const width of [390, 1280]) {
    for (const submit of ['typing', 'enter'] as const) {
      test(`skeleton stays under the field and lines up with the results: ${
        clinical ? 'clinical' : 'lookup'
      }, ${width}px, ${submit}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await mountBuiltApp(page, {
          skipLargeCompanionPacks: true,
          ...(process.env.MINIMED_LIVE_URL ? { origin: process.env.MINIMED_LIVE_URL } : {}),
        });
        await waitForSearchReady(page);
        if (clinical) await setClinicalAnalysis(page, true);
        const input = page.getByTestId('search-input');
        await input.click();
        await startSampling(page);
        if (submit === 'typing') {
          await input.pressSequentially(QUERY, { delay: 10 });
        } else {
          await input.fill(QUERY);
          await page.keyboard.press('Enter');
        }
        await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('search-skeleton')).toHaveCount(0);
        const samples = await readSamples(page);
        const skeletonTops = samples.flatMap((sample) =>
          sample.skeleton === undefined || sample.skeletonOpacity < VISIBLE_OPACITY
            ? []
            : [sample.skeleton],
        );
        // Typing always waits out the debounce, so the skeleton must have been on screen.
        if (submit === 'typing') expect(skeletonTops.length).toBeGreaterThan(3);
        const firstTop = skeletonTops[0];
        if (firstTop === undefined) return;
        // It never moves: not while the intro folds away, not while the analysis row arrives.
        for (const top of skeletonTops) expect(Math.abs(top - firstTop)).toBeLessThanOrEqual(2);
        // The results appear at the skeleton's position.
        const resultsTop = samples.find((sample) => sample.results !== undefined)?.results;
        expect(resultsTop).toBeDefined();
        expect(Math.abs((resultsTop ?? 0) - firstTop)).toBeLessThanOrEqual(2);
      });
    }
  }
}

test('skeleton mirrors the result group and its shimmer stops under reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    ...(process.env.MINIMED_LIVE_URL ? { origin: process.env.MINIMED_LIVE_URL } : {}),
  });
  await waitForSearchReady(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const input = page.getByTestId('search-input');
  await input.click();
  await input.pressSequentially(QUERY, { delay: 10 });
  const skeleton = page.getByTestId('search-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.result-group-header__body').first()).toBeVisible();
  await expect(skeleton.locator('.result-card').first()).toBeVisible();
  const shimmer = await skeleton
    .locator('.results-skeleton__group')
    .first()
    .evaluate((element) => getComputedStyle(element, '::after').display);
  expect(shimmer).toBe('none');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(skeleton).toHaveCount(0);
});
