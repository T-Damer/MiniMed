import { mountBuiltApp, waitForSearchReady } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';

/**
 * Owner 2026-10-08: while a new .db loaded (module install, core reload, pack attach) the search
 * page kept turning into a loader — no results, one spinner in the middle. Background data changes
 * must leave the visible results alone. The loader was the app's page-level Suspense fallback,
 * shown whenever a result card refetched a plain `createResource` (see `state/quiet-resource.ts`).
 */

interface PaneSample {
  readonly at: number;
  readonly loader: boolean;
  readonly results: boolean;
  readonly firstGroupTop: number | undefined;
}

/** Records the search pane on every DOM change and every frame. */
async function watchSearchPane(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: PaneSample[] = [];
    const pane = document.querySelector('.search-home')?.closest('.app-view');
    if (!pane) throw new Error('The search pane is missing.');
    const sample = (): void => {
      const loader = pane.querySelector('.app-view__loading');
      samples.push({
        at: Math.round(performance.now()),
        loader: loader !== null && getComputedStyle(loader).display !== 'none',
        results: pane.querySelector('[data-testid="search-results"]') !== null,
        firstGroupTop: pane.querySelector('.result-group')?.getBoundingClientRect().top,
      });
    };
    new MutationObserver(sample).observe(pane, { childList: true, subtree: true });
    const frame = (): void => {
      sample();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    (window as unknown as { __paneSamples: PaneSample[] }).__paneSamples = samples;
  });
}

async function paneSamples(page: Page): Promise<readonly PaneSample[]> {
  return page.evaluate(() =>
    (window as unknown as { __paneSamples: PaneSample[] }).__paneSamples.slice(),
  );
}

for (const query of ['Депрессия', 'пневмония у детей']) {
  test(`results stay on screen through background data changes: ${query}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchReady(page);
    const input = page.getByTestId('search-input');
    await input.fill(query);
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('search-skeleton')).toHaveCount(0);
    // Let the packaged modules the runtime installs after start-up settle (each one swaps the core).
    await page.waitForTimeout(2_000);

    await watchSearchPane(page);
    // What a module install tells the page: the module runtime and the app preferences notify the
    // result cards (their data sources change), and the content-changed event re-runs the query.
    for (let round = 0; round < 3; round += 1) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('minimed:app-preferences'));
        window.dispatchEvent(new CustomEvent('minimed:content-changed'));
      });
      await page.waitForTimeout(600);
    }
    await expect(page.getByTestId('search-results')).toBeVisible();

    const samples = await paneSamples(page);
    expect(samples.length).toBeGreaterThan(10);
    expect(samples.filter((sample) => sample.loader)).toEqual([]);
    expect(samples.filter((sample) => !sample.results)).toEqual([]);
    // The list does not jump while the query re-runs behind it.
    const tops = samples.flatMap((sample) =>
      sample.firstGroupTop === undefined ? [] : [sample.firstGroupTop],
    );
    for (const top of tops) expect(Math.abs(top - (tops[0] ?? top))).toBeLessThanOrEqual(2);
  });
}
