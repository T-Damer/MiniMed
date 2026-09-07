import { expect, test } from '@playwright/test';

for (const width of [360, 1280]) {
  test(`unified queue remains accessible before core readiness at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/content/core-report.json', async (route) => {
      await blocked;
      await route.abort();
    });
    const unexpected: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('evil.invalid')) unexpected.push(request.url());
    });
    await page.addInitScript(() => {
      // Completed/failed public records are history, not executable URLs or consent to fetch.
      if (localStorage.getItem('queue-test-seeded')) return;
      localStorage.setItem('queue-test-seeded', '1');
      localStorage.setItem(
        'minimed.download-queue.v1',
        JSON.stringify({
          version: 1,
          tasks: [
            {
              id: 'images:test-edition',
              kind: 'images',
              title: 'Тестовые иллюстрации',
              state: 'completed',
              downloadedBytes: 100,
              totalBytes: 100,
            },
            {
              id: 'speech:test-edition',
              kind: 'speech',
              title: 'Тестовая модель речи',
              state: 'failed',
              downloadedBytes: 50,
              totalBytes: 100,
              url: 'https://evil.invalid/payload',
            },
          ],
        }),
      );
    });
    try {
      await page.goto('http://127.0.0.1:4173/#/settings/downloads', {
        waitUntil: 'domcontentloaded',
      });
      const downloads = page.getByTestId('downloads-page');
      await expect(downloads).toBeVisible();
      await expect(page.locator('.boot-card')).toBeHidden();
      await expect(downloads.getByText('Тестовая модель речи', { exact: true })).toBeVisible();
      await downloads.getByRole('button', { name: 'История', exact: true }).click();
      await expect(downloads.getByText('Тестовые иллюстрации', { exact: true })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow).toBe(false);
      const navigation = page.getByRole('navigation', { name: 'Разделы приложения' });
      await navigation.getByRole('button', { name: 'Калькуляторы', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Калькуляторы/u }).first()).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = '#/settings/downloads';
      });
      await expect(downloads).toBeVisible();
      await downloads.getByRole('button', { name: 'История', exact: true }).click();
      await downloads.getByRole('button', { name: 'Очистить историю', exact: true }).click();
      await expect(downloads.getByText('Тестовые иллюстрации', { exact: true })).toHaveCount(0);
      await expect(downloads.getByText('Тестовая модель речи', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => performance.getEntriesByName('minimed:search-ready').length),
      ).toBe(0);
      expect(unexpected).toEqual([]);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
