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

async function expectBookmarkBeforeTitle(page: Page): Promise<void> {
  const row = page.locator('.reader-title-row').first();
  const bookmark = row.locator('.item-bookmark');
  const title = row.getByRole('heading', { level: 1 });
  await expect(bookmark).toBeVisible();
  const [mark, heading] = await Promise.all([bookmark.boundingBox(), title.boundingBox()]);
  if (!mark || !heading) throw new Error('Title row geometry is unavailable.');
  // In front of the title, on its line, centred on it.
  expect(mark.x + mark.width).toBeLessThanOrEqual(heading.x);
  expect(Math.abs(mark.y + mark.height / 2 - (heading.y + heading.height / 2))).toBeLessThan(4);
}

for (const width of [375, 1280]) {
  test(`a medication card's header menu prints and saves; the bookmark sits on the title row at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    await mockPrintPopup(page);
    await routeMedicationModule(page);
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await installMedicationModule(page);
    const title = await openFirstMedicationCard(page);

    // The drug screen has its own header: the bookmark and the recipe sit on the title row.
    const header = page.locator('.drug-header');
    const bookmark = header.getByRole('button', { name: /^Сохранить «/u });
    const heading = header.getByRole('heading', { level: 1 });
    await expect(bookmark).toBeVisible();
    await expect(heading).toHaveText(title);
    // Borderless icon on the title row, after the title (the recipe icon sits beside it).
    const [mark, headingBox] = await Promise.all([bookmark.boundingBox(), heading.boundingBox()]);
    if (!mark || !headingBox) throw new Error('Drug header geometry is unavailable.');
    expect(mark.x).toBeGreaterThanOrEqual(headingBox.x);
    expect(mark.y).toBeLessThan(headingBox.y + headingBox.height);
    // Nothing is left of the old lonely bookmark under the card.
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
    await expect(header.getByRole('button', { name: /^Сохранено:/u })).toBeVisible();
  });
}

test('a personal file uses the same header menu and title bookmark', async ({ page }) => {
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

  await expectBookmarkBeforeTitle(page);
  await page.getByRole('button', { name: 'Меню действий' }).click();
  await expect(page.getByRole('menuitem', { name: 'Печать' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Сохранить в коллекцию' }).click();
  await expect(page.getByRole('dialog', { name: 'Сохранить: план' })).toBeVisible();
});
