import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

test('a medication card keeps its catalog product after a page reload', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page
    .locator('.medication-product-card')
    .filter({ hasText: 'Ибупрофен 100 мг/5 мл' })
    .first()
    .click({ timeout: 30_000 });

  const productTitle = page.locator('.drug-header__title');
  await expect(productTitle).toBeVisible({ timeout: 30_000 });
  const heading = (await productTitle.textContent())?.trim() ?? '';
  expect(heading).not.toBe('');
  const openedUrl = page.url();

  await page.reload();

  expect(page.url()).toBe(openedUrl);
  await expect(productTitle).toHaveText(heading, { timeout: 30_000 });
});
