import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  openFirstMedicationCard,
  routeMedicationModule,
} from './medication-module-fixture';
import { mountBuiltApp } from './mount-built-app';

/** Printing opens a popup and calls its print(); count the calls without opening anything. */
async function mockPrintPopup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { __printed: number };
    state.__printed = 0;
    window.open = (() => ({
      opener: null,
      document: { open() {}, write() {}, close() {}, images: [] },
      focus() {},
      close() {},
      print() {
        state.__printed += 1;
      },
    })) as unknown as typeof window.open;
  });
}

/** No bookmark beside the title (owner 2026-10-20): saving lives in «⋯» → «Сохранить в коллекцию». */
async function expectNoBookmarkOnTitleRow(page: Page): Promise<void> {
  await expect(
    page.locator('.reader-title-row').first().getByRole('heading', { level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.reader-title-row .item-bookmark:visible')).toHaveCount(0);
}

for (const width of [375, 1280]) {
  test(`a medication card's header menu prints and saves; saving is in «⋯», not on the title row at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    await mockPrintPopup(page);
    await routeMedicationModule(page);
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await installMedicationModule(page);
    const title = await openFirstMedicationCard(page);

    // The drug screen has its own header: only the title, no bookmark or recipe icon beside it
    // (owner 2026-10-20); both are items of «⋯».
    const header = page.locator('.drug-header');
    const heading = header.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(title);
    await expect(header.getByRole('button', { name: /^Сохранить «/u })).toBeHidden();
    await expect(page.locator('.document-overlay-paper__actions .item-bookmark')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`reader-${width}.png`) });

    const menuButton = page.getByRole('button', { name: 'Меню действий' });
    await menuButton.click();
    // The drug's own actions come with print in the same menu.
    await expect(page.getByRole('menuitem', { name: 'Поделиться' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Печать' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1);

    // Reopen from the keyboard: a pointer click during the menu's closing animation is absorbed.
    await expect(page.getByRole('menuitem', { name: 'Печать' })).toHaveCount(0);
    // The page may still settle its scroll position after opening; a scroll closes an open menu.
    let settled = -1;
    await expect(async () => {
      const now = await page.evaluate(() => window.scrollY);
      const stable = now === settled;
      settled = now;
      expect(stable).toBe(true);
    }).toPass({ intervals: [600], timeout: 15_000 });
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Сохранить в коллекцию' }).click();
    const panel = page.getByRole('dialog', { name: `Сохранить: ${title}` });
    await expect(panel.getByText('Сохранить в')).toBeVisible();
    await panel.getByRole('checkbox', { name: /Избранные/u }).check();
    await page.keyboard.press('Escape');
    // The menu's anchor now names the saved state.
    await expect(page.locator('.item-bookmark[aria-label^="Сохранено:"]')).toHaveCount(1);
  });
}

test('a personal file uses the same header menu, saving from «⋯»', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await page.getByLabel('Загрузить документы').setInputFiles({
    name: 'план.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('План обследования.'),
  });
  await page.locator('.user-library-card').filter({ hasText: 'план' }).click();
  await expect(page.locator('.user-document-reader')).toContainText('План обследования.');

  await expectNoBookmarkOnTitleRow(page);
  await page.getByRole('button', { name: 'Меню действий' }).click();
  await expect(page.getByRole('menuitem', { name: 'Печать' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Сохранить в коллекцию' }).click();
  await expect(page.getByRole('dialog', { name: 'Сохранить: план' })).toBeVisible();
});
