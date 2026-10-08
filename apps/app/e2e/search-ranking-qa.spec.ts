import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// QA pass UX13, search findings S2 and S5: a form number finds the form, and a bare disease name
// leads with its article, not with the questionnaires that mention it.
test('a form number finds the form and nothing unrelated', async ({ page }) => {
  test.slow();
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
  await expect(page.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
    timeout: 90_000,
  });

  await page.getByTestId('search-input').fill('070/у');
  const form = page.locator('.unified-catalog__tool[href="#/notes/forms/ru.minzdrav.274n.070u"]');
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form).toContainText('Форма № 070/у');
  await expect(page.getByTestId('search-results')).not.toContainText('Трикуспидальный');
});

test('a bare disease name leads with the article, tools wait behind it', async ({ page }) => {
  test.slow();
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
  await expect(page.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
    timeout: 90_000,
  });

  await page.getByTestId('search-input').fill('Депрессия');
  await expect(page.locator('.result-group').first()).toContainText(/депресс/iu, {
    timeout: 30_000,
  });
  const tool = page.locator('.unified-catalog__tool').filter({ hasText: 'послеродовой' }).first();
  await expect(tool).toBeVisible();
  const article = await page.locator('.result-group').first().boundingBox();
  const scale = await tool.boundingBox();
  expect(article).not.toBeNull();
  expect(scale).not.toBeNull();
  if (article && scale) expect(article.y).toBeLessThan(scale.y);

  // Asking for a scale puts the tools first again.
  await page.getByTestId('search-input').fill('шкала депрессии');
  const asked = page.locator('.unified-catalog__tool').first();
  await expect(asked).toBeVisible({ timeout: 30_000 });
  const askedBox = await asked.boundingBox();
  const firstResult = await page.locator('.result-group').first().boundingBox();
  if (askedBox && firstResult) expect(askedBox.y).toBeLessThan(firstResult.y);
});
