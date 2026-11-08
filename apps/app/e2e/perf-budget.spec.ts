import { expect, test } from '@playwright/test';

import {
  installClinicalModule,
  PNEUMONIA_CHILDREN_TARGET,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';
import { installPerfProbes, startSampling, stopSampling, waitForSettled } from './perf-harness';

/**
 * PERF5 regression budgets (docs/research/perf-2026-11.md). The bundle rule is exact; the timings
 * are generous ceilings, several times what a production build measures on a Mac, so a loaded
 * machine passes and a regression of the kind PERF5 removed (a whole-page layout per slice, the
 * first search's indexes inside the query) does not. The full measurement is `perf-baseline`.
 */

test('the first screen loads neither the release catalog nor pdf.js nor tesseract', async ({
  page,
}) => {
  await mountBuiltApp(page);
  await page.waitForFunction(() => performance.getEntriesByName('minimed:boot-reveal').length > 0);
  const early = await page.evaluate(() => {
    const reveal = performance.getEntriesByName('minimed:boot-reveal')[0]?.startTime ?? 0;
    return (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((entry) => entry.startTime <= reveal)
      .map((entry) => entry.name.split('/').at(-1) ?? '');
  });
  // `module-catalog-<hash>.js` is the ~10 MB release catalog; its shell and state are small.
  expect(early.filter((name) => /^module-catalog-(?!shell|state)[\w-]+\.js$/u.test(name))).toEqual(
    [],
  );
  expect(early.filter((name) => /^(pdfjs-document|tesseract|worker\.min)/u.test(name))).toEqual([]);
});

test('a long clinical recommendation and a search stay within their time budgets', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.addInitScript(installPerfProbes);
  await routeClinicalModule(page, PNEUMONIA_CHILDREN_TARGET);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await installClinicalModule(page, PNEUMONIA_CHILDREN_TARGET);
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible();

  // Reopen from the start page: first text and every section mounted.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchEditable(page);
  await page.waitForTimeout(1500);
  const from = await startSampling(
    page,
    ['.document-overlay-section__paragraph'],
    '.document-overlay-section',
  );
  await page.evaluate((id) => {
    window.location.hash = `#/modules/documents/d/${id}`;
  }, Buffer.from(PNEUMONIA_CHILDREN_TARGET.documentId).toString('base64url'));
  await waitForSettled(page, '(s.flags & 1) !== 0', 1500, 60_000);
  const reader = await stopSampling(page, from);
  const firstText = reader.samples.find((sample) => (sample.flags & 1) !== 0);
  const finalCount = reader.samples.at(-1)?.count ?? 0;
  const mounted = reader.samples.find((sample) => sample.count === finalCount);
  expect(finalCount).toBeGreaterThan(40);
  // Measured on a Mac (PERF5): first text ≈ 10 ms, all 63 sections ≈ 200 ms.
  expect((firstText?.t ?? Number.POSITIVE_INFINITY) - from).toBeLessThan(1_500);
  expect((mounted?.t ?? Number.POSITIVE_INFINITY) - from).toBeLessThan(5_000);

  // A typed query: «По названию» after the 500 ms pause, the full list soon after.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchEditable(page);
  await page.waitForTimeout(1500);
  const searchFrom = await startSampling(page, [
    '.search-meanings--titles',
    '.results-list .result-group[data-document-id]',
  ]);
  await page.getByTestId('search-input').click();
  await page.keyboard.type('пневмония', { delay: 60 });
  await waitForSettled(page, '(s.flags & 2) !== 0', 1000, 60_000);
  const search = await stopSampling(page, searchFrom);
  const lastInput = search.keys.at(-1) ?? searchFrom;
  const titles = search.samples.find((sample) => sample.t >= lastInput && (sample.flags & 1) !== 0);
  const groups = search.samples.find((sample) => sample.t >= lastInput && (sample.flags & 2) !== 0);
  // Measured on a Mac (PERF5): titles ≈ 510 ms (the debounce), groups ≈ 600–900 ms.
  expect((titles?.t ?? Number.POSITIVE_INFINITY) - lastInput).toBeLessThan(2_000);
  expect((groups?.t ?? Number.POSITIVE_INFINITY) - lastInput).toBeLessThan(6_000);
});
