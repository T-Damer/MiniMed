import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const query = 'Ребёнок часто дышит и температурит второй день';

test('finds a recommendation section and opens local context', async ({ page }) => {
  await mountBuiltApp(page);
  await expect(page.getByText('Что нужно найти?')).toBeVisible();
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(page.getByText('Внебольничная пневмония у детей').first()).toBeVisible();
  await expect(page.getByTestId('search-mode')).toHaveText('FTS5 + VECTOR');
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await page.getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toContainText('Клиническая картина');
  await expect(page.getByTestId('reader-context')).toContainText('тахипноэ');
});

test('keeps the active search mounted while navigating through the app', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(page.getByText('Внебольничная пневмония у детей').first()).toBeVisible();

  await page.getByRole('button', { name: 'Архив и граф' }).click();
  await expect(page.getByRole('heading', { name: 'Архив знаний' })).toBeVisible();
  await page.getByRole('button', { name: 'Поиск' }).click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(page.getByText('Внебольничная пневмония у детей').first()).toBeVisible();
});
