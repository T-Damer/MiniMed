import { E2E_ASSET_ORIGIN, mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  openFirstMedicationCard,
  routeMedicationModule,
} from './medication-module-fixture';

/** Waits until a sheet and its scrim have finished their entrance, so screenshots are at rest. */
async function settled(sheet: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      sheet.evaluate((element) => {
        const layer = element.closest('.overlay-backdrop') ?? element;
        return document.getAnimations().filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          // The entrance animates the scrim and the sheet itself, not the content inside.
          return animation.playState === 'running' && (target === layer || target === element);
        }).length;
      }),
    )
    .toBe(0);
}

async function openToolsSheet(page: Page) {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  // Wait for the rise animation to finish before measuring.
  await expect
    .poll(() =>
      sheet.evaluate(
        (element) =>
          element.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  return sheet;
}

test.describe('phone sheets', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a dialog is a paper sheet from the bottom edge that closes by pull, scrim or Escape', async ({
    page,
  }, testInfo) => {
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    let sheet = await openToolsSheet(page);
    const box = await sheet.boundingBox();
    expect(box ? Math.round(box.y + box.height) : 0).toBe(812);
    expect(box?.width).toBe(375);
    expect(box?.y).toBeGreaterThanOrEqual(40);
    const grip = sheet.locator('.overlay-dialog__grip');
    await expect(grip).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sheet-375.png') });

    // Focus stays inside the sheet.
    for (let step = 0; step < 12; step += 1) await page.keyboard.press('Tab');
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    // A short nudge springs back; a long pull closes.
    const gripBox = await grip.boundingBox();
    if (!gripBox) throw new Error('Grip geometry is unavailable.');
    const x = gripBox.x + gripBox.width / 2;
    const y = gripBox.y + gripBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 10 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    // A cancelled gesture returns the sheet to rest, even past the close threshold.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 120, { steps: 10 });
    await grip.dispatchEvent('pointercancel', { pointerId: 1, clientY: y + 120 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 220, { steps: 12 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0);

    // The scrim above the sheet closes it too, and so does Escape.
    sheet = await openToolsSheet(page);
    await page.mouse.click(187, 20);
    await expect(sheet).toHaveCount(0);
    sheet = await openToolsSheet(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('panels open as sheets: search sections, collections and help', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await routeMedicationModule(page);
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
    const sections = page.getByRole('dialog', { name: 'Разделы поиска' });
    await settled(sections);
    await expect(sections.locator('.overlay-dialog__grip')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sections-375.png') });
    await page.keyboard.press('Escape');
    await expect(sections).toHaveCount(0);

    await page.getByRole('button', { name: 'Справка', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Справка' });
    await expect(help.locator('.overlay-dialog__grip')).toBeVisible();
    await help.getByRole('button', { name: 'Как работает поиск' }).click();
    await expect(help).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Как работает поиск' })).toBeVisible();
    await page.keyboard.press('Escape');

    await installMedicationModule(page);
    const title = await openFirstMedicationCard(page);
    await page
      .getByRole('button', { name: /^Сохранить «/u })
      .first()
      .click();
    const save = page.getByRole('dialog', { name: `Сохранить: ${title}` });
    await settled(save);
    await expect(save.locator('.overlay-dialog__grip')).toBeVisible();
    await expect(save.getByRole('checkbox', { name: /Избранные/u })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('collections-375.png') });
  });

  test('a confirmation is the same sheet, as an alert dialog', async ({ page }, testInfo) => {
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
    await page.getByRole('button', { name: 'Действия со страницей' }).click();
    await page.getByRole('menuitem', { name: 'Создать папку', exact: true }).click();
    await page.getByLabel('Название новой папки').fill('Разборы');
    await page.keyboard.press('Enter');
    const folder = page.getByRole('button', { name: 'Открыть папку «Разборы»' });
    await expect(folder).toBeVisible();
    await folder.click({ button: 'right' });
    // Kobalte selects on pointer or keyboard; the keyboard avoids a scroll that closes the menu.
    await page.getByRole('menuitem', { name: 'Удалить папку' }).focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('alertdialog');
    await settled(confirm);
    await expect(page.getByRole('menuitem', { name: 'Удалить папку' })).toHaveCount(0);
    await expect(confirm.locator('.overlay-dialog__grip')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('confirm-375.png') });
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(folder).toBeVisible();
  });
});

test.describe('desktop sheets', () => {
  test.use({ viewport: { width: 1280, height: 844 } });

  test('dialogs are centred paper sheets and panels stay popovers', async ({ page }, testInfo) => {
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const sheet = await openToolsSheet(page);
    const box = await sheet.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(44 * 16 + 1);
    expect(box ? Math.abs(box.x + box.width / 2 - 640) : 99).toBeLessThan(2);
    await expect(sheet.locator('.overlay-dialog__grip')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('sheet-1280.png') });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
    await settled(page.getByRole('dialog', { name: 'Разделы поиска' }));
    await expect(page.locator('.overlay-dialog')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('sections-1280.png') });
  });
});
