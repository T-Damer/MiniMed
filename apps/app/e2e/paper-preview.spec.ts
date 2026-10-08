import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('the form print preview fits a phone and zooms with the buttons', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/notes/forms/ru.minzdrav.274n.070u';
  });
  await page.getByRole('button', { name: 'Предпросмотр и печать' }).click();
  const dialog = page.getByRole('dialog');
  const sheet = dialog.locator('.paper-preview__sheet');
  const viewport = dialog.locator('.paper-preview__viewport');
  await expect(sheet).toBeVisible();

  // Fitted to the width: no horizontal scrolling, the whole page width is on screen.
  const fitted = await viewport.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(fitted.scroll).toBeLessThanOrEqual(fitted.client + 1);
  const fitWidth = (await sheet.boundingBox())?.width ?? 0;
  await expect(dialog.getByRole('button', { name: 'Уменьшить' })).toBeDisabled();

  // The + button enlarges the page; it then scrolls sideways inside the preview.
  for (let step = 0; step < 4; step++) {
    await dialog.getByRole('button', { name: 'Увеличить' }).click();
  }
  await expect
    .poll(async () => (await sheet.boundingBox())?.width ?? 0)
    .toBeGreaterThan(fitWidth * 1.8);
  const zoomed = await viewport.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(zoomed.scroll).toBeGreaterThan(zoomed.client + 50);
  await page.screenshot({ path: test.info().outputPath('zoomed.png') });

  // The frame lets every touch through to the zoom surface.
  await expect(dialog.locator('.paper-preview__frame')).toHaveCSS('pointer-events', 'none');

  // Back to the fitted page.
  for (let step = 0; step < 4; step++) {
    await dialog.getByRole('button', { name: 'Уменьшить' }).click();
  }
  await expect
    .poll(async () => (await sheet.boundingBox())?.width ?? 0)
    .toBeLessThan(fitWidth * 1.05);
});
