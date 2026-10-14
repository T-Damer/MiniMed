import { expect, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchReady } from './mount-built-app';

// DL1: a first visit while offline is not a blank page. The search says the network is missing and
// that the main database downloads by itself once it returns; nothing is fetched until then, and
// the download starts on the `online` event without a reload or a tap.
test('a first visit offline says so and starts the download when the network returns', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    let online = false;
    Object.defineProperty(navigator, 'onLine', { get: () => online, configurable: true });
    Object.assign(window, {
      __setOnline: (value: boolean) => {
        online = value;
        if (value) window.dispatchEvent(new Event('online'));
      },
    });
  });
  const coreDownloads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/core\.db(\.gz)?(\?|$)/u.test(request.url())) {
      coreDownloads.push(request.url());
    }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page);

  const status = page.locator('.search-core-status');
  await expect(status).toContainText('Нет сети', { timeout: 60_000 });
  await expect(status).toContainText('скачается сама, когда появится соединение');
  // The rest of the app stays usable meanwhile.
  await expect(page.locator('.app-bottom-nav')).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(coreDownloads).toEqual([]);

  await page.evaluate(() =>
    (window as unknown as { __setOnline: (v: boolean) => void }).__setOnline(true),
  );
  await expect.poll(() => coreDownloads.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await waitForSearchReady(page);
  await expect(status).toHaveCount(0);
});
