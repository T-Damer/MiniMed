import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test.setTimeout(90000);

test('searches the built-in adult CKD-EPI reference from free search', async ({ page }) => {
  await mountBuiltApp(page);

  await page.getByTestId('search-input').fill('Формула CKD-EPI 2021 для расчета СКФ у взрослого');
  await page.getByTestId('search-submit').click();

  await expect(page.getByTestId('search-results')).toContainText(
    'Расчетная СКФ у взрослых — CKD-EPI 2021',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('search-results')).toContainText('Для взрослых');
});

test('searches the built-in current adult primary-care regulation', async ({ page }) => {
  await mountBuiltApp(page);

  await page
    .getByTestId('search-input')
    .fill('Приказ 202н первичная медико-санитарная помощь взрослым');
  await page.getByTestId('search-submit').click();

  await expect(page.getByTestId('search-results')).toContainText(
    'Первичная медико-санитарная помощь взрослым — приказ № 202н',
    { timeout: 30_000 },
  );
});
