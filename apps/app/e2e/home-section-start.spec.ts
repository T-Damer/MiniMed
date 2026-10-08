import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('the «Калькуляторы» row of the home opens the list itself, without the promo carousel', async ({
  page,
}) => {
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await expect(page.locator('.search-home-intro')).toBeVisible();
  await page
    .locator('.search-sections__row')
    .filter({ has: page.locator('.search-sections__name', { hasText: /^Калькуляторы$/u }) })
    .click();
  await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
  await expect(page.locator('.search-home-intro')).toHaveCount(0);
  const firstTool = page.locator('.unified-catalog__tool').first();
  await expect(firstTool).toBeVisible();
  const box = await firstTool.boundingBox();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(500);
  // Back to the section list brings the promo back.
  await page.goBack();
  await expect(page.locator('.search-home-intro')).toBeVisible();
});
