import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * Owner 2026-11-06: «Везде» took ~3 s with nothing on screen. The documents whose names carry the
 * words show at once (title index), the full-text results follow below them without moving them,
 * and on a phone the keyboard goes away when the search starts.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test('a submitted search shows title answers first and puts the keyboard away', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  const field = page.locator('.query-sheet__input');
  await field.click();
  await field.fill('пневмония');
  await field.press('Enter');

  const titles = page.locator('.search-meanings--titles');
  await expect(titles).toBeVisible({ timeout: 10_000 });
  await expect(titles.locator('.choice-chip').first()).toContainText(/пневмони/iu);
  await expect(field).not.toBeFocused();

  // The full-text results arrive below; the title answers stay where they were.
  const before = await titles.boundingBox();
  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 60_000 });
  const after = await titles.boundingBox();
  expect(after?.y).toBe(before?.y);
  const firstResult = await page.locator('.result-group').first().boundingBox();
  expect(firstResult?.y ?? 0).toBeGreaterThan((after?.y ?? 0) + (after?.height ?? 0) - 1);
});
