import { expect, test } from '@playwright/test';

const LIVE_URL = process.env.MINIMED_LIVE_URL;

test.describe('published MiniMed prototype', () => {
  test.skip(!LIVE_URL, 'Live Pages smoke test requires MINIMED_LIVE_URL.');
  test.setTimeout(240_000);

  test('exposes questionnaires and calculators on GitHub Pages', async ({ page }) => {
    await page.goto(LIVE_URL as string, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const nav = page.locator('.app-bottom-nav');
    await expect(nav.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(nav.locator('.app-nav-button')).toHaveCount(3);
    await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
    const splitNavigation = page.getByRole('switch', { name: 'Разбивать навигацию на разделы' });
    await splitNavigation.click();
    await expect(splitNavigation).toHaveAttribute('aria-checked', 'true');
    await expect(nav.getByRole('button', { name: 'Тесты', exact: true })).toBeVisible({
      // Expanded navigation becomes available once the discovery core is ready.
      timeout: 180_000,
    });
    await nav.getByRole('button', { name: 'Тесты', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();
    await expect(page.getByText('Психология и психодиагностика').first()).toBeVisible();

    await nav.getByRole('button', { name: 'Калькуляторы', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Калькуляторы' })).toBeVisible();
    await expect(page.getByLabel('Поиск калькуляторов')).toBeVisible();
  });
});
