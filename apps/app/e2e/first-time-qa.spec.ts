import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const FORM_HASH = '#/notes/forms/ru.minzdrav.1094n.107-1u';
const SAVED_ITEMS = JSON.stringify({
  version: 2,
  favorites: [
    {
      kind: 'document',
      id: 'doc.pneumonia',
      title: 'Внебольничная пневмония у взрослых',
      addedAt: '2026-10-13T10:00:00.000Z',
    },
  ],
  collections: [],
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
});

test('a form draft survives leaving the form through the bottom tab and a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, FORM_HASH);

  const patientName = page.locator('#form-field-patientFullName').getByRole('textbox');
  await patientName.fill('Тестов Тест Тестович');
  await expect(page.locator('.form-progress__state')).toHaveText('Черновик сохранён');

  // Away to the search tab and back through «Мои файлы» → «Формы» → the same form.
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, FORM_HASH);
  await expect(page.locator('#form-field-patientFullName').getByRole('textbox')).toHaveValue(
    'Тестов Тест Тестович',
  );

  await page.reload();
  await expect(page.locator('#form-field-patientFullName').getByRole('textbox')).toHaveValue(
    'Тестов Тест Тестович',
    { timeout: 30_000 },
  );
  await expect(page.locator('.form-progress__state')).toHaveText('Черновик сохранён');
});

test('the Files tab opens the file list, and saved items are a folder that the search finds', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, {
    splitNavigation: false,
    skipLargeCompanionPacks: true,
    localStorage: { 'minimed.collections.v2': SAVED_ITEMS },
  });
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, FORM_HASH);
  await expect(page.locator('#form-field-patientFullName')).toBeVisible();

  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваши файлы' })).toBeVisible();

  const folder = page.locator('.user-library-folder-card').filter({ hasText: 'Избранное' });
  await expect(folder).toContainText('1 элемент');

  const search = page.getByPlaceholder('Название или файл');
  await search.fill('Избран');
  await expect(folder).toBeVisible();
  await search.fill('пневмония');
  await expect(
    page.locator('.user-library-page__saved').getByText('Внебольничная пневмония у взрослых'),
  ).toBeVisible();

  await search.fill('');
  await folder.click();
  await expect(page.getByRole('heading', { name: 'Избранное', level: 1 })).toBeVisible();
  await expect(page.locator('.saved-items')).toContainText('Внебольничная пневмония у взрослых');
});
