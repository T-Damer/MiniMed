import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

async function chooseScope(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('radio', { name }).click();
}

test('searches the built-in adult CKD-EPI reference from the norms scope', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /В клин\. рекомендациях/u);

  await page
    .getByTestId('search-input')
    .fill('Формула CKD-EPI 2021 для расчета СКФ у взрослого');
  await page.getByTestId('search-submit').click();

  await expect(page.getByTestId('search-results')).toContainText(
    'Расчетная СКФ у взрослых — CKD-EPI 2021',
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('search-results')).toContainText('Для взрослых');
});

test('searches the built-in current adult primary-care regulation', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Правовые документы/u);

  await page
    .getByTestId('search-input')
    .fill('Приказ 202н первичная медико-санитарная помощь взрослым');
  await page.getByTestId('search-submit').click();

  await expect(page.getByTestId('search-results')).toContainText(
    'Первичная медико-санитарная помощь взрослым — приказ № 202н',
    { timeout: 10_000 },
  );
});
