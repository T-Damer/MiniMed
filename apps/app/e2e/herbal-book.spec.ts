import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * The herbal book «Травник»: its two committed module packs are served from this checkout (not from
 * GitHub), installed from the offers in the book, and a chapter is opened with its quote cells.
 */
const MODULE_FILES = resolve(import.meta.dirname, '../public/content/modules');

async function serveHerbalModules(page: Page): Promise<void> {
  await page.route(/\/minimed\.reference\.herbal[^/]*$/u, (route) => {
    const name = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' },
      body: readFileSync(join(MODULE_FILES, name)),
    });
  });
}

async function openChapter(page: Page, title: string): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/herbal`);
  await page.getByRole('button', { name: `Открыть «${title}»` }).click();
  await expect(page.locator('.document-overlay-paper__title')).toContainText(title, {
    timeout: 30_000,
  });
}

test('installs «Травник», opens a chapter and shows a source quote', async ({ page }) => {
  test.setTimeout(300_000);
  await serveHerbalModules(page);
  await mountBuiltApp(page, { persistentOrigin: true, waitForCore: true });

  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/herbal`);
  const offer = page.locator('.herbal-book__offer');
  await expect(offer).toContainText('30 растений', { timeout: 60_000 });
  await offer.getByRole('button', { name: /^Скачать/u }).click();
  await expect(page.locator('.herbal-card')).toHaveCount(30, { timeout: 120_000 });

  // The plates are an image pack offered inside the book.
  await page.locator('.herbal-book__plates-offer').getByRole('button').first().click();
  await expect(page.locator('.herbal-book__plates-offer')).toHaveCount(0, { timeout: 120_000 });

  await openChapter(page, 'Ромашка аптечная');
  const chapter = page.locator('.herbal-chapter');
  await expect(chapter).toContainText('Как заварить');
  await expect(chapter).toContainText('Кому нельзя');
  await chapter.locator('.herbal-cell', { hasText: 'Сырьё' }).first().click();
  const quote = page.locator('.herbal-quote').first();
  await expect(quote).toBeVisible();
  await expect(quote).toContainText('Инструкция ГРЛС');
  await page.goBack();
  await expect(page.locator('.herbal-quote')).toHaveCount(0);
  await expect(page.locator('.document-overlay-paper__title')).toContainText('Ромашка аптечная');

  // EMA found no safe oral use of celandine: its verdict comes before the recipe.
  await openChapter(page, 'Чистотел большой');
  const headings = page.locator('.herbal-chapter__heading');
  await expect(headings.first()).toContainText('Позиция EMA');

  // Field identification from the ГФ article, and the look-alikes ГФ and EMA name.
  await openChapter(page, 'Хвощ полевой');
  const lookalikes = page.locator('.herbal-chapter__heading', { hasText: 'Не спутать' });
  await expect(lookalikes).toBeVisible();
  await expect(page.locator('.herbal-chapter')).toContainText(
    'Хвощ болотный (Equisetum palustre L.)',
  );
  await expect(page.locator('.document-overlay-paper')).toContainText('Как узнать');
  await expect(page.locator('.document-overlay-paper')).toContainText('ФС.2.5.0045');
});
