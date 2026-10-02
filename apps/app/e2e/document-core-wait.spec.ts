import { expect, test } from '@playwright/test';

const ORIGIN = process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173';
// A clinical-recommendation pointer from the core pack («Острая ишемия конечностей»).
const DOCUMENT_ROUTE = `#/modules/documents/d/${Buffer.from(
  'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac',
).toString('base64url')}`;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`a document link opened while the core loads says why it waits at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
    let releaseCore = () => {};
    const coreGate = new Promise<void>((resolve) => {
      releaseCore = resolve;
    });
    await page.route('**/core.db', async (route) => {
      await coreGate;
      await route.continue();
    });
    await page.goto(`${ORIGIN}/${DOCUMENT_ROUTE}`, { waitUntil: 'domcontentloaded' });
    try {
      const status = page.locator('.document-core-wait .search-core-status');
      await expect(status).toContainText(/Подготавливаем поиск|Загружаем базу/u);
      await expect(page.getByText('Документ откроется, когда база будет готова')).toBeVisible();
      await expect(page.locator('.app-bottom-nav')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`document-core-wait-${viewport.width}.png`),
      });
    } finally {
      releaseCore();
    }
    // Once the core is ready the same route shows the document itself.
    await expect(page.locator('.document-core-wait')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('.document-overlay-paper__title')).toBeVisible();
  });
}
