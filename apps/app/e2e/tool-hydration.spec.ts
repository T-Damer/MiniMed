import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

for (const available of [true, false]) {
  test(`tool routes wait for local packages (${available ? 'installed' : 'absent'})`, async ({
    page,
  }) => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/content/modules/**', async (route) => {
      await gate;
      if (available) await route.continue();
      else await route.abort();
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    try {
      await page.evaluate(() => {
        window.location.hash = '#/calculators/body-surface-area-mosteller';
      });
      await expect(page.getByRole('heading', { name: 'Подключаем калькулятор' })).toBeVisible();
      await expect(
        page
          .locator('.calculator-pack-required')
          .getByRole('button', { name: 'Скачать', exact: true }),
      ).toHaveCount(0);
      await page.evaluate(() => {
        window.location.hash =
          '#/assessments/gastroenterology/pediatric-ulcerative-colitis-activity-index';
      });
      await expect(page.getByRole('heading', { name: 'Подключаем опросник' })).toBeVisible();
      await expect(page.locator('.assessment-missing-body')).toHaveCount(0);
    } finally {
      release();
    }
    if (available) await expect(page.locator('.assessment-workspace')).toBeVisible();
    else await expect(page.locator('.assessment-missing-body')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Подключаем опросник' })).toHaveCount(0);
  });
}
