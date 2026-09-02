import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
const CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
const MODULE_URL = 'https://localmed-datasets.example.com/regulatory-e2e.db';
const REGULATORY_QUERY =
  'Какие дети подлежат диспансерному наблюдению после заболевания, травмы или отравления';

interface TestCatalog {
  publishedAt: string;
  modules: Array<{
    id: string;
    sizes: { downloadBytes: number; installedBytes: number };
    artifacts: Array<{ sha256: string; sizeBytes: number }>;
  }>;
}

function currentCatalog(raw: string, database: Buffer): string {
  const catalog = JSON.parse(raw) as TestCatalog;
  const module = catalog.modules.find((entry) => entry.id === 'minimed.regulatory.pediatrics.ru');
  const artifact = module?.artifacts[0];
  if (!module || !artifact) throw new Error('Regulatory E2E module is missing from the catalog.');
  const size = database.byteLength;
  module.sizes.downloadBytes = size;
  module.sizes.installedBytes = size;
  artifact.sizeBytes = size;
  artifact.sha256 = `sha256:${createHash('sha256').update(database).digest('hex')}`;
  catalog.publishedAt = '2099-01-01T00:00:00Z';
  return JSON.stringify(catalog);
}

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-bottom-nav').getByRole('button', { name });
}

function regulatorySection(page: Page): Locator {
  return page.locator('article[aria-label="Открыть набор «Законы и нормативные акты»"]').first();
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

test('installs a regulatory dataset, searches it live, and removes it without reload', async ({
  page,
}) => {
  const [catalog, database] = await Promise.all([
    readFile(resolve(ROOT, 'data/build/e2e-regulatory-catalog.json'), 'utf8'),
    readFile(resolve(ROOT, 'data/build/rf-regulatory-pilot.db')),
  ]);
  const catalogBody = currentCatalog(catalog, database);

  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: catalogBody,
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
  await page.getByRole('radio', { name: /Всё без диагностики/u }).click();
  await page.getByTestId('search-input').fill(REGULATORY_QUERY);
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible();
  await navigationButton(page, 'База знаний').click();
  await regulatorySection(page).click();

  await page.getByRole('button', { name: 'Скачать все документы' }).click();
  await expect(page.getByRole('button', { name: /^Открыть «/u }).first()).toBeVisible({
    timeout: 30_000,
  });

  await navigationButton(page, 'Поиск').click();
  await page.getByRole('radio', { name: /Правовые документы/u }).click();
  await expect(page.getByTestId('search-input')).toHaveValue(REGULATORY_QUERY);
  await expect
    .poll(() => page.getByTestId('search-results').locator('.result-group').count(), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator('.result-group-header__kind-label').first()).toHaveText(
    'Нормативный акт',
  );
  await expect(page.locator('.error-card')).toHaveCount(0);

  await navigationButton(page, 'База знаний').click();
  await navigationButton(page, 'База знаний').click();
  await regulatorySection(page).click();
  await page.getByRole('button', { name: /^Удалить «Нормативные документы РФ/u }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скачать все документы' })).toBeVisible({
    timeout: 15_000,
  });

  await navigationButton(page, 'Поиск').click();
  await page.getByRole('radio', { name: /Всё без диагностики/u }).click();
  await page.getByTestId('search-input').fill('пневмония');
  await page.getByTestId('search-submit').click();
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/Пневмония/u)
      .first(),
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
  const catalogBody = currentCatalog(catalog, database);

  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: catalogBody,
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
  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings/downloads`);
  await expect(page.getByTestId('content-download-status')).toBeVisible();
  await navigationButton(page, 'База знаний').click();
  await regulatorySection(page).click();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Скачать все документы' }).click();
  await expect(page.getByRole('button', { name: 'Скачать все документы' })).toHaveCount(0);
  await page.getByTestId('content-download-nav').click();
  await expect(page).toHaveURL(/#\/settings\/downloads/u);
  const manager = page.getByTestId('content-download-status');
  await expect(manager).toContainText('Нет сети');
  await expect(manager.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();

  downloadAvailable = true;
  await context.setOffline(false);
  await expect(manager).toContainText('Тут будут ваши загрузки', { timeout: 30_000 });
  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('button', { name: /^Открыть «/u }).first()).toBeVisible();
});
