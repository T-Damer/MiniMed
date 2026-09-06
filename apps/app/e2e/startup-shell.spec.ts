import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
]) {
  test(`navigation and calculators work while the database is pending at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/content/core-report.json', async (route) => {
      await blocked;
      await route.abort();
    });
    try {
      await page.goto('http://127.0.0.1:4173/#/search', { waitUntil: 'domcontentloaded' });
      const navigation = page.getByRole('navigation', { name: 'Разделы приложения' });
      await expect(navigation).toBeVisible();
      await expect(page.locator('.boot-card__title')).toContainText('Открываем документы');
      await navigation.getByRole('button', { name: 'Калькуляторы', exact: true }).click();
      await expect(page).toHaveURL(/#\/calculators/u);
      await expect(page.locator('.boot-card')).toBeHidden();
      await expect(page.getByRole('heading', { name: /Калькуляторы/u }).first()).toBeVisible();
      await navigation.getByRole('button', { name: 'Поиск', exact: true }).click();
      await expect(page.locator('.boot-card')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeHidden();
      const marks = await page.evaluate(() => ({
        navigation: performance.getEntriesByName('minimed:navigation-ready').length,
        search: performance.getEntriesByName('minimed:search-ready').length,
      }));
      expect(marks).toEqual({ navigation: 1, search: 0 });
    } finally {
      release?.();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
