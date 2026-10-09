import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

/** The success notice for a finished download, and its link to what was installed. */
async function openFromNotice(page: Page, text: string | RegExp, timeout = 60_000): Promise<void> {
  const notice = page.locator('.app-notification').filter({ hasText: text });
  await expect(notice).toBeVisible({ timeout });
  await notice.getByRole('button', { name: 'Открыть', exact: true }).click();
}

for (const width of [375, 1280]) {
  test(`a downloaded calculator section opens from its notice at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/calculators`);
    const anthropometry = page.getByTestId('calculator-section-anthropometry');
    await anthropometry.getByRole('button', { name: 'Скачать раздел — Антропометрия' }).click();

    // Leave the catalog: the notice still leads back to exactly the downloaded section.
    await page.goto(`${E2E_ASSET_ORIGIN}/#/settings`);
    await openFromNotice(page, '«Антропометрия» скачан');
    await expect(page).toHaveURL(/#\/calculators\/section\/anthropometry$/u);
  });

  test(`a downloaded document set opens from its notice at ${width}px`, async ({ page }) => {
    // The set is fetched over the network (about 70 s alone); a parallel run needs more headroom.
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchEditable(page);
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents`);
    await page
      .locator('article[aria-label="Открыть набор «Нормы и расчёты»"]')
      .getByRole('button', { name: 'Скачать раздел «Нормы и расчёты»' })
      .click();

    await openFromNotice(page, 'Раздел «Нормы и расчёты» скачан', 180_000);
    await expect(page).toHaveURL(/#\/modules\/documents\/collection\/reference$/u);
  });
}
