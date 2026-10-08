import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('a section bar names its section beside «назад», the search field below it', async ({
  page,
}) => {
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/notes/templates';
  });
  const bar = page.locator('.note-templates-catalog__search-chrome');
  const back = bar.getByRole('button', { name: 'Назад к заметкам' });
  const title = bar.getByRole('heading', { level: 1, name: 'Ваши шаблоны' });
  const search = bar.getByRole('searchbox', { name: 'Поиск по шаблонам' });
  await expect(title).toBeVisible();
  const [backBox, titleBox, searchBox] = await Promise.all([
    back.boundingBox(),
    title.boundingBox(),
    search.boundingBox(),
  ]);
  if (!backBox || !titleBox || !searchBox) throw new Error('The section bar is not laid out.');
  // One row for back, title and the actions; the field takes the row below.
  expect(titleBox.x).toBeGreaterThan(backBox.x + backBox.width);
  expect(
    Math.abs(titleBox.y + titleBox.height / 2 - (backBox.y + backBox.height / 2)),
  ).toBeLessThan(backBox.height / 2);
  expect(searchBox.y).toBeGreaterThan(backBox.y + backBox.height);
  // The creating and upload buttons sit in that row too, and the old breadcrumb chip is gone.
  const create = bar.getByRole('button', { name: 'Создать шаблон' });
  const createBox = await create.boundingBox();
  expect(createBox && createBox.y < searchBox.y).toBe(true);
  await expect(page.locator('.note-templates-catalog__breadcrumbs')).toHaveCount(0);
});
