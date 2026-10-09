import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

// A source name typed in the search field is not text to find: «Красота и медицина пневмония»
// searches pneumonia inside that source and says so; a bare name lists the source; the note's
// «Искать везде» searches the typed words as they are.
test('a typed source name limits the search to that source and can be undone', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toHaveAttribute('data-search-ready', 'true', { timeout: 60_000 });
  const note = page.getByTestId('search-source-note');
  const results = page.getByTestId('search-results');

  await input.fill('Красота и медицина пневмония');
  await page.getByTestId('search-submit').click();
  await expect(note).toContainText('Красота и медицина', { timeout: 30_000 });
  await expect(note).toContainText('«пневмония»');
  await expect(results.getByText('Пневмония', { exact: true }).first()).toBeVisible();

  await page.getByTestId('search-source-everywhere').click();
  await expect(note).toHaveCount(0);
  await expect(results).toBeVisible();

  // An ordinary query names no source.
  await input.fill('пневмония');
  await page.getByTestId('search-submit').click();
  await expect(results.getByText('Пневмония', { exact: true }).first()).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('a bare source name lists the source instead of finding text', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toHaveAttribute('data-search-ready', 'true', { timeout: 60_000 });

  await input.fill('клинические рекомендации');
  await page.getByTestId('search-submit').click();
  const note = page.getByTestId('search-source-note');
  await expect(note).toContainText('Клинические рекомендации', { timeout: 30_000 });
  await expect(note).toContainText('материал');
  // The source's own documents are listed; "nothing found" is not shown.
  await expect(page.getByTestId('search-source-everywhere')).toHaveCount(0);
  await expect(page.locator('.archive-page').first()).toBeVisible();
  await expect(page.getByText('Ничего не найдено')).toHaveCount(0);
});
