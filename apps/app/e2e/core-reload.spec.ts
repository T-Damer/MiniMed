import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

test('the persistent core reopens after repeated page reloads', async ({ page }) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('search-input')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Не удалось открыть ядро MiniMed/)).toHaveCount(0);
  }
  await page.getByTestId('search-input').fill('А09');
  await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 60_000 });
});
