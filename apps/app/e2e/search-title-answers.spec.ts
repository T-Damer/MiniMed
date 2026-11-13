import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * Owner 2026-11-06: on a phone the keyboard goes away when the search starts. Owner 2026-11-13:
 * a document appears once — the «По названию» strip that repeated the first results above them is
 * gone; the results skeleton holds the place until the list arrives.
 */
const SHOTS = process.env['SRCHDRUG_SHOTS'];

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test('a submitted search puts the keyboard away and lists each document once', async ({ page }) => {
  test.setTimeout(180_000);
  await mountBuiltApp(page, { waitForCore: true, skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  const field = page.locator('.query-sheet__input');
  await field.click();
  await field.fill('пневмония');
  await field.press('Enter');
  await expect(field).not.toBeFocused();

  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.search-meanings--titles')).toHaveCount(0);
  // No document of the list is offered again as a choice above it.
  const listed = await page
    .locator('.result-group[data-document-id]')
    .evaluateAll((groups) => groups.map((group) => group.getAttribute('data-document-id')));
  expect(new Set(listed).size).toBe(listed.length);

  // Title matches the list leaves out (a narrower article) follow it once, under «Ещё по названию».
  const extras = page.locator('.search-title-extras');
  await page.waitForTimeout(500);
  if ((await extras.count()) > 0) {
    const listedTitles = (await page.locator('.result-group').allInnerTexts()).join('\n');
    for (const title of await extras.locator('.list-row__title').allInnerTexts()) {
      expect(listedTitles).not.toContain(title);
    }
    if (SHOTS) {
      await extras.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/7-title-extras-375-light.png` });
    }
  }
});
