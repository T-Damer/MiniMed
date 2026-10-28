import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { waitForHomeSections } from '@localmed/app/e2e/select-search-section';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('a tap on the history backdrop closes the drawer and reaches nothing beneath', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForHomeSections(page);
  const section = page.locator('.search-sections__row').first();
  await section.scrollIntoViewIfNeeded();
  const box = await section.boundingBox();
  if (!box) throw new Error('The search home shows no section row');

  await page.getByRole('button', { name: 'Показать историю поиска', exact: true }).tap();
  const panel = page.getByRole('complementary', { name: 'Недавние поисковые запросы' });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  if (!panelBox) throw new Error('The history drawer has no box');
  // Right of the drawer, over the section row the backdrop covers.
  const x = Math.max(panelBox.x + panelBox.width + 16, box.x + box.width - 24);
  await page.touchscreen.tap(x, box.y + box.height / 2);

  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/#\/search$/u);
});
