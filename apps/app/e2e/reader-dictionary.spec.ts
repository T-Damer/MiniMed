import { expect, type Page, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticPdf } from './synthetic-pdf';

async function openClinicalDocument(page: Page): Promise<void> {
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
}

/**
 * Writes `word` at the start of the n-th text chunk and selects it, as a doctor selecting that word
 * in the text would (the reader's own text is left otherwise alone).
 */
async function selectWordInChunk(page: Page, chunkIndex: number, word: string): Promise<void> {
  // The reader mounts its sections in idle batches: wait until the chunk exists.
  await page.locator('.document-text-chunk').nth(chunkIndex).waitFor({ state: 'attached' });
  await page.evaluate(
    ({ chunkIndex: index, word: text }) => {
      const chunk = document.querySelectorAll('.document-text-chunk')[index];
      if (!chunk) throw new Error('chunk not found');
      chunk.scrollIntoView({ block: 'center', behavior: 'instant' });
      const node = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
      if (!node) throw new Error('chunk has no text');
      node.data = `${text} ${node.data}`;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { chunkIndex, word },
  );
}

test('a selected word with no dictionary entry shows what was found and «Искать везде»', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openClinicalDocument(page);
  await selectWordInChunk(page, 2, 'абракадабраз');
  const lookup = page.getByTestId('selection-lookup');
  await expect(lookup).toBeVisible();
  await expect(lookup).toContainText('Найти в словаре');
  await page.screenshot({ path: test.info().outputPath('selection-menu-375.png') });
  await lookup.click();
  const sheet = page.getByTestId('reader-dictionary');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('reader-dictionary-empty')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath('lookup-empty-375.png') });
  await sheet.getByTestId('reader-dictionary-search-all').click();
  await expect(page).toHaveURL(/#\/search/u);
  await expect(page.getByTestId('search-input')).toHaveValue('абракадабраз', { timeout: 30_000 });
});

test('an inflected word opens the definition preview of its headword', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openClinicalDocument(page);
  await selectWordInChunk(page, 2, 'бронхитом');
  await page.getByTestId('selection-lookup').click();
  const sheet = page.getByTestId('reader-dictionary');
  const card = sheet.getByTestId('definition-preview');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.definition-preview__term')).toContainText('Бронхит');
  await page.screenshot({ path: test.info().outputPath('lookup-definition-375.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(sheet).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('lookup-definition-375-dark.png') });
});

test('a misspelt word is corrected by the search stack before the lookup gives up', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openClinicalDocument(page);
  await selectWordInChunk(page, 2, 'оменция');
  await page.getByTestId('selection-lookup').click();
  const sheet = page.getByTestId('reader-dictionary');
  await expect(sheet.getByTestId('definition-preview')).toBeVisible({ timeout: 60_000 });
  await expect(sheet.locator('.definition-preview__term')).toContainText('Аменция');
  await page.screenshot({ path: test.info().outputPath('lookup-typo-375.png') });
});

test('a long selection offers no dictionary lookup', async ({ page }) => {
  test.setTimeout(240_000);
  await openClinicalDocument(page);
  await selectWordInChunk(page, 2, 'один два три четыре пять шесть семь восемь');
  await expect(page.locator('.user-highlight-popup')).toBeVisible();
  await expect(page.getByTestId('selection-lookup')).toHaveCount(0);
});

test('a word selected in the PDF text layer offers the dictionary lookup', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: 'dictionary-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticPdf({ pages: 3 }),
  });
  const card = page.locator('.user-library-card').filter({ hasText: 'dictionary-fixture' });
  await card.first().waitFor();
  await expect(card.first()).toContainText('Текстовый слой найден');
  await card.first().click();
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(3);
  await expect(page.locator('.user-document-reader__banner')).toHaveCount(0, { timeout: 60_000 });
  const run = page.locator('.pdf-viewer__text-run', { hasText: 'Marker 1' }).first();
  await run.waitFor({ state: 'attached', timeout: 30_000 });
  await run.dblclick();
  const lookup = page.getByTestId('selection-lookup');
  await expect(lookup).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('pdf-menu-390.png') });
  await lookup.click();
  await expect(page.getByTestId('reader-dictionary')).toBeVisible();
  await expect(page.getByTestId('reader-dictionary-search-all')).toBeVisible({ timeout: 60_000 });
});
