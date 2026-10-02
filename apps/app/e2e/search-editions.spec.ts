import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

// «Туберкулез у детей»: the registry replaced edition 507_3 with 507_4 under the same title, and
// the core keeps both as clinical pointers. Results show only the current edition.
test('search shows one edition of a clinical recommendation, the current one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );
  const input = page.getByTestId('search-input');
  await input.fill('Туберкулез у детей');
  await input.press('Enter');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 30_000 });
  const editions = page.locator('.result-group[data-document-id*="clinical.kr.rf.507_"]');
  await expect(editions).toHaveCount(1);
  await expect(editions).toHaveAttribute('data-document-id', /kr\.rf\.507_4/u);
});
