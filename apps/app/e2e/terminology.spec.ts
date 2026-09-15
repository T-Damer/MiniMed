import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const fixtures = resolve(import.meta.dirname, '../../../data/build/terminology-e2e');
const query = 'Синдром Мюнхгаузена';

async function mountTerminology(page: Page, edition: 'discovery' | 'installed'): Promise<void> {
  const [database, report] = await Promise.all([
    readFile(resolve(fixtures, `${edition}.db`)),
    readFile(resolve(fixtures, `${edition}-report.json`)),
  ]);
  // Replace only immutable HTTP pack assets. Real SolidJS, workers, SQLite, ranking, and reader run.
  await page.route(`${E2E_ASSET_ORIGIN}/content/*.db`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return name === 'core.db'
      ? route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: database,
          headers: { 'Content-Length': String(database.byteLength) },
        })
      : route.fulfill({ status: 404, body: 'No companion in the synthetic fixture.' });
  });
  await page.route(`${E2E_ASSET_ORIGIN}/content/core-report.json`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: report }),
  );
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(page.locator('.result-group').first()).toContainText('Медицинский термин');
  await expect(page.locator('.result-group').first()).toContainText(query);
}

test('core-only terminology keeps the term and its own definition readable without a detail pack', async ({
  page,
}) => {
  await mountTerminology(page, 'discovery');
  await page.locator('.result-group').first().locator('.result-group-header').click();
  await expect(page.locator('.document-page')).toContainText(
    'Synthetic source definition, not medical guidance.',
  );
  await expect(page.locator('.document-page')).toContainText('Определение 1 (en)');
  await expect(page.locator('.document-page')).not.toContainText('Another synthetic definition.');
});

test('core-only lookup indexes source occurrences without calling them installed full text', async ({
  page,
}) => {
  await mountTerminology(page, 'discovery');
  const mention = page
    .locator('.result-group')
    .filter({ hasText: 'Вхождение термина в источнике' })
    .first();
  await expect(mention).toContainText(query);
  await mention.locator('.result-group-header').click();
  await expect(page.locator('.document-page')).toContainText('Вхождения терминов — указатель');
  await expect(page.locator('.document-page')).not.toContainText(
    'Первый Синдром Мюнхгаузена; повтор:',
  );
});

test('installed source remains readable and the longer by-proxy concept does not replace the base term', async ({
  page,
}) => {
  await mountTerminology(page, 'installed');
  const mention = page
    .locator('.result-group')
    .filter({ hasText: 'Вхождение термина в источнике' })
    .first();
  await mention.locator('.result-group-header').click();
  await expect(page.locator('.document-page')).toContainText('Первый Синдром Мюнхгаузена; повтор:');
  await expect(page.locator('.document-page')).toContainText('Munchausen Syndrome by Proxy.');
});
