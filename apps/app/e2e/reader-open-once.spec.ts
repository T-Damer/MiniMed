import { expect, test } from '@playwright/test';

import {
  CLINICAL_DOCUMENT_ROUTE,
  CLINICAL_POINTER_ID,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/** Which of the three things a reader screen can show is on screen right now. */
const SAMPLER = `(() => {
  const states = [];
  const sample = () => {
    const loading = document.querySelector('.document-page__loading');
    const pointer = document.querySelector('.document-module-pointer');
    const content = document.querySelector('.document-overlay-section__title');
    const state = content ? 'content' : pointer ? 'pointer' : loading ? 'loading' : 'blank';
    if (states.at(-1) !== state) states.push(state);
    window.__readerStates = states;
  };
  new MutationObserver(sample).observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  sample();
})()`;

test('a document opens through one loading state and then stays', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await page.getByTestId('search-input').waitFor();
  await page.evaluate(SAMPLER);
  await page.evaluate((route) => {
    location.hash = new URL(route).hash;
  }, CLINICAL_DOCUMENT_ROUTE);
  await expect(page.locator('.document-overlay-section__title').first()).toBeVisible();
  // Let the idle section batches and the late catalog lookups finish.
  await page.waitForTimeout(2_500);
  const states = await page.evaluate(
    () => (window as unknown as { __readerStates: string[] }).__readerStates,
  );
  expect(states.filter((state) => state !== 'blank')).toEqual(['loading', 'content']);
});

test('a pointer of an installed module opens its document without showing the pointer first', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await page.getByTestId('search-input').waitFor();
  await page.evaluate(SAMPLER);
  const pointerRoute = `#/modules/documents/d/${Buffer.from(CLINICAL_POINTER_ID).toString('base64url')}`;
  await page.evaluate((hash) => {
    location.hash = hash;
  }, pointerRoute);
  await expect(page.locator('.document-overlay-section__title').first()).toBeVisible();
  await page.waitForTimeout(2_500);
  const states = await page.evaluate(
    () => (window as unknown as { __readerStates: string[] }).__readerStates,
  );
  expect(states.filter((state) => state !== 'blank')).toEqual(['loading', 'content']);
});
