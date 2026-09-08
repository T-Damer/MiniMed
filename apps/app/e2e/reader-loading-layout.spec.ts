import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

for (const width of [390, 1280]) {
  test(`reader keeps navigation in place while loading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page);
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/a3IucmYuNzE0XzIucG5ldW1vbmlh`);
    await page.getByRole('button', { name: 'Загрузить полный текст' }).click();
    await page.locator('.document-overlay-section__title').first().waitFor();
    await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
    await page.getByTestId('search-input').waitFor();
    await page.evaluate(() => {
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
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.evaluate(() => {
      location.hash = '#/modules/documents/d/a3IucmYuNzE0XzIucG5ldW1vbmlh';
    });
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
