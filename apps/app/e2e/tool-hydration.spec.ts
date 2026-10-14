import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

// Optional tool packages install only on request (e72af7f8): a fresh profile fetches nothing on its
// own, and a tool route offers the download instead of waiting for it.
for (const available of [true, false]) {
  test(`tool routes offer optional packages on request (${available ? 'available' : 'unreachable'})`, async ({
    page,
  }) => {
    const requests: string[] = [];
    await page.route('**/content/modules/**', async (route) => {
      requests.push(route.request().url());
      if (available) await route.continue();
      else await route.abort();
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.evaluate(() => {
      window.location.hash = '#/calculators/body-surface-area-mosteller';
    });
    const required = page.locator('.calculator-pack-required');
    const download = required.getByRole('button', { name: /^Скачать(?: · [^·]+)?$/u });
    await expect(download).toBeVisible();
    // The page has the standard header row: a back arrow and the title, then the offer.
    await expect(required.getByRole('button', { name: 'К разделам калькуляторов' })).toBeVisible();
    await expect(required.getByRole('heading', { level: 3 })).toContainText('Mosteller');
    await expect(page.getByRole('heading', { name: 'Подключаем калькулятор' })).toHaveCount(0);
    expect(requests).toEqual([]);

    await download.click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    if (available) {
      await expect(required).toHaveCount(0, { timeout: 30_000 });
    } else {
      await expect(required).toBeVisible();
      await expect(download).toBeVisible();
    }
  });
}
