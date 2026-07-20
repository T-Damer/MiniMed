import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('finds a recommendation section and opens local context', async ({ page }) => {
  await mountBuiltApp(page);
  await expect(page.getByText('Что нужно найти?')).toBeVisible();
  await page.getByTestId('search-input').fill('Ребёнок часто дышит и температурит второй день');
  await page.getByTestId('search-submit').click();
  await expect(page.getByText('Внебольничная пневмония у детей').first()).toBeVisible();
  await expect(page.getByTestId('search-mode')).toHaveText('FTS5 + VECTOR');
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await page.getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toContainText('Клиническая картина');
  await expect(page.getByTestId('reader-context')).toContainText('тахипноэ');
});
