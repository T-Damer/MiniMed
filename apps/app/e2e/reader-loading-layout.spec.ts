import { expect, test } from '@playwright/test';

import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

for (const width of [390, 1280]) {
  test(`reader keeps navigation in place while loading at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 844 });
    await routeClinicalModule(page);
    await mountBuiltApp(page);
    await installClinicalModule(page);
    await page.locator('.document-overlay-section__title').first().waitFor();
    await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
    await page.getByTestId('search-input').waitFor();
    await page.evaluate(() => {
      // Sample on every DOM change, not once per frame: a cached document can finish loading
      // within a single frame, and a frame sampler then never sees the loading layout.
      const sample = (): void => {
        const toggle = document.querySelector<HTMLButtonElement>(
          '.document-overlay-outline-toggle',
        );
        const back = document.querySelector('.document-page__back');
        if (toggle?.disabled && back) {
          document.documentElement.dataset.loadingBackLeft = String(
            back.getBoundingClientRect().left,
          );
          document.documentElement.dataset.loadingToggleLeft = String(
            toggle.getBoundingClientRect().left,
          );
        }
      };
      new MutationObserver(sample).observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });
    await page.evaluate((route) => {
      location.hash = new URL(route).hash;
    }, CLINICAL_DOCUMENT_ROUTE);
    const toggle = page.locator('.document-overlay-outline-toggle');
    await expect(toggle).toBeEnabled();
    const positions = await page.evaluate(() => ({
      loadingBack: Number(document.documentElement.dataset.loadingBackLeft),
      loadingToggle: Number(document.documentElement.dataset.loadingToggleLeft),
      readyBack: document.querySelector('.document-page__back')?.getBoundingClientRect().left,
      readyToggle: document
        .querySelector('.document-overlay-outline-toggle')
        ?.getBoundingClientRect().left,
    }));
    expect(positions.loadingBack).toBeCloseTo(positions.readyBack ?? -1, 0);
    expect(positions.loadingToggle).toBeCloseTo(positions.readyToggle ?? -1, 0);
  });
}
