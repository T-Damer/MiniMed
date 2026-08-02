import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
const CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
const MODULE_URL = 'https://localmed-datasets.example.com/regulatory-e2e.db';
const REGULATORY_QUERY = 'Порядок диспансерного наблюдения несовершеннолетних';
const REGULATORY_TITLE = `${REGULATORY_QUERY} — приказ № 192н`;

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-bottom-nav').getByRole('button', { name });
}

function regulatoryCard(page: Page): Locator {
  return page.locator('.module-card').filter({ hasText: 'Нормативные документы РФ: педиатрия' });
}

async function hideBuiltInRegulatoryPack(page: Page): Promise<void> {
  await page.route('**/content/regulatory.db', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'not installed in this scenario',
    }),
  );
}

async function visibleSearchState(page: Page): Promise<string> {
  const error = await page.locator('.error-card').textContent();
  if (error) return `ERROR: ${error}`;
  const results = page.getByTestId('search-results');
  if ((await results.count()) === 0) return 'WAITING_FOR_RESULTS';
  return (await results.innerText()) || 'EMPTY_RESULTS';
}

test('installs a regulatory dataset, searches it live, and removes it without reload', async ({
  page,
}) => {
  const [catalog, database] = await Promise.all([
    readFile(resolve(ROOT, 'data/build/e2e-regulatory-catalog.json'), 'utf8'),
    readFile(resolve(ROOT, 'data/build/rf-regulatory-pilot.db')),
  ]);
  const catalogValue = JSON.parse(catalog) as { publishedAt: string };
  catalogValue.publishedAt = '2099-01-01T00:00:00Z';
  const currentCatalog = JSON.stringify(catalogValue);

  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: currentCatalog,
        headers: {
          ETag: '"e2e-regulatory-catalog"',
          'Last-Modified': 'Wed, 22 Jul 2026 00:00:00 GMT',
        },
      });
    },
  );
  await page.route(MODULE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: database,
      headers: { 'Content-Length': String(database.byteLength) },
    });
  });
  await hideBuiltInRegulatoryPack(page);

  await mountBuiltApp(page, { persistentOrigin: true });
  await navigationButton(page, 'База знаний').click();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await page.getByRole('button', { name: /^Законы и нормативные акты/u }).click();

  const card = regulatoryCard(page);
  await expect(card.getByRole('button', { name: 'Скачать документы' })).toBeVisible();
  await card.getByRole('button', { name: 'Скачать документы' }).click();
  await expect(card.locator('.module-state')).toHaveText('Установлено', { timeout: 30_000 });
  await expect(card.getByText('SHA-256 и SQLite проверены')).toBeVisible();

  await navigationButton(page, 'Поиск').click();
  const legalScope = page.getByRole('radio', { name: /Правовые документы/u });
  await expect(legalScope).toBeEnabled({ timeout: 30_000 });
  await legalScope.click();
  await page.getByTestId('search-input').fill(REGULATORY_QUERY);
  await page.getByTestId('search-submit').click();
  await expect.poll(() => visibleSearchState(page), { timeout: 20_000 }).toContain(REGULATORY_TITLE);

  await navigationButton(page, 'База знаний').click();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await page.getByRole('button', { name: /^Законы и нормативные акты/u }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: 'Удалить с устройства' }).click();
  await expect(card.getByRole('button', { name: 'Скачать документы' })).toBeVisible({
    timeout: 15_000,
  });

  await navigationButton(page, 'Поиск').click();
  await page.getByRole('radio', { name: /Всё без диагностики/u }).click();
  await page.getByTestId('search-input').fill(`${REGULATORY_QUERY} после удаления`);
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).not.toContainText(REGULATORY_TITLE);

  await page.getByTestId('search-input').fill('Ребёнок часто дышит и температурит второй день');
  await page.getByTestId('search-submit').click();
  await expect(
    page.getByTestId('search-results').getByText('Внебольничная пневмония у детей').first(),
  ).toBeVisible();
});

test('shows the real download state and resumes automatically when the network returns', async ({
  page,
  context,
}) => {
  const [catalog, database] = await Promise.all([
    readFile(resolve(ROOT, 'data/build/e2e-regulatory-catalog.json'), 'utf8'),
    readFile(resolve(ROOT, 'data/build/rf-regulatory-pilot.db')),
  ]);
  const catalogValue = JSON.parse(catalog) as { publishedAt: string };
  catalogValue.publishedAt = '2099-01-01T00:00:00Z';

  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(catalogValue),
      }),
  );
  let downloadAvailable = false;
  await page.route(MODULE_URL, (route) =>
    downloadAvailable
      ? route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: database,
          headers: { 'Content-Length': String(database.byteLength) },
        })
      : route.abort('internetdisconnected'),
  );
  await hideBuiltInRegulatoryPack(page);

  await mountBuiltApp(page, { persistentOrigin: true });
  await navigationButton(page, 'База знаний').click();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await page.getByRole('button', { name: /^Законы и нормативные акты/u }).click();

  await context.setOffline(true);
  const card = regulatoryCard(page);
  await card.getByRole('button', { name: 'Скачать документы' }).click();
  await expect(card.getByRole('button', { name: 'Скачать документы' })).toHaveCount(0);
  await page.locator('.content-download-pill').click();
  const manager = page.locator('.content-download-status.floating');
  await expect(manager).toContainText('Нет сети');
  await expect(manager.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();

  downloadAvailable = true;
  await context.setOffline(false);
  await expect(card.locator('.module-state')).toHaveText('Установлено', { timeout: 30_000 });
  await expect(manager).toHaveCount(0);
});
