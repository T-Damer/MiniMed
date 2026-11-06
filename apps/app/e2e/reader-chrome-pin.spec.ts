import { expect, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

/**
 * Owner 2026-11-06: the reader's top bar hid oddly; it now follows a deliberate scroll, can be
 * pinned from «⋯», and the contents list shows its scrollbar beside the cards, not over them.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test('the reader bar follows a deliberate scroll and stays when pinned', async ({ page }) => {
  test.setTimeout(300_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await installClinicalModule(page);
  await expect(page.locator('.document-page__body')).toBeVisible({ timeout: 60_000 });
  const root = page.locator('html');

  // A few pixels of jitter leave the bar where it is; a real scroll down hides it.
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
  await expect(root).toHaveClass(/app-chrome-hidden/u);
  // The page settles under the sliding bar first (its shifts are not the reader's scroll).
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    for (let step = 0; step < 3; step += 1) {
      window.scrollBy({ top: -4, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await expect(root).toHaveClass(/app-chrome-hidden/u);
  // An upward run brings it back.
  await page.evaluate(async () => {
    for (let step = 0; step < 4; step += 1) {
      window.scrollBy({ top: -12, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await expect(root).not.toHaveClass(/app-chrome-hidden/u);
  // The bar has slid back in before its menu opens.
  await page.waitForTimeout(500);

  // «⋯» → «Закрепить панель»: scrolling down no longer hides it, also after a reload.
  await page.getByRole('button', { name: 'Меню действий' }).click();
  await page.getByRole('menuitem', { name: 'Закрепить панель' }).click();
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await expect(root).not.toHaveClass(/app-chrome-hidden/u);
  await page.reload();
  await expect(page.locator('.document-page__body')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await expect(root).not.toHaveClass(/app-chrome-hidden/u);
});

test('the contents list keeps its scrollbar off the cards', async ({ page }) => {
  test.setTimeout(240_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await installClinicalModule(page);
  await expect(page.locator('.document-page__body')).toBeVisible({ timeout: 60_000 });
  await page.locator('.document-overlay-outline-toggle').click();
  const nav = page.locator('.document-overlay-outline-nav');
  await expect(nav).toBeVisible();
  const viewport = page.locator(
    '.document-overlay-outline-nav-scroll [data-overlayscrollbars-viewport]',
  );
  const { hidden, client } = await viewport.evaluate((element) => ({
    hidden: element.scrollHeight - element.clientHeight,
    client: element.clientHeight,
  }));
  const needsBar = hidden > Math.max(64, client * 0.15);
  // With a bar the cards leave it a lane; with little to scroll there is no bar and no lane.
  if (needsBar) await expect(nav).toHaveClass(/document-overlay-outline-nav--gutter/u);
  else await expect(nav).not.toHaveClass(/document-overlay-outline-nav--gutter/u);
});
