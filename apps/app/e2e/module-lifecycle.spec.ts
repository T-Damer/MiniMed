import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
const CATALOG_URL =
  'https://github.com/T-Damer/MiniMed/releases/download/datasets-preview-1/catalog.preview.json';
const MODULE_URL = 'https://localmed-datasets.example.com/regulatory-e2e.db';
const REGULATORY_TITLE = 'Порядок диспансерного наблюдения несовершеннолетних — приказ № 192н';

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-nav-icons').getByRole('button', { name });
}

function regulatoryCard(page: Page): Locator {
  return page.locator('.module-card').filter({ hasText: 'Нормативные документы РФ: педиатрия' });
}

test('installs a regulatory dataset, searches it live, and removes it without reload', async ({
  page,
}) => {
  const [catalog, database] = await Promise.all([
    readFile(resolve(ROOT, 'data/build/e2e-regulatory-catalog.json'), 'utf8'),
    readFile(resolve(ROOT, 'data/build/rf-regulatory-pilot.db')),
  ]);

  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: catalog,
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

  await mountBuiltApp(page, { persistentOrigin: true });
  await navigationButton(page, 'База знаний').click();

  const card = regulatoryCard(page);
  await expect(card.getByRole('button', { name: 'Скачать документы' })).toBeVisible();
  await card.getByRole('button', { name: 'Скачать документы' }).click();
  await expect(card.locator('.module-state')).toHaveText('Установлено', { timeout: 30_000 });
  await expect(card.getByText('SHA-256 и SQLite проверены')).toBeVisible();
  await expect(card.getByText('Версия 0.3.3', { exact: true })).toBeVisible();

  await navigationButton(page, 'Поиск').click();
  await page.getByTestId('search-input').fill('приказ 192н диспансерное наблюдение');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results').getByText(REGULATORY_TITLE).first()).toBeVisible({
    timeout: 10_000,
  });

  await navigationButton(page, 'База знаний').click();
  await card.getByRole('button', { name: 'Удалить с устройства' }).click();
  await expect(card.getByRole('button', { name: 'Скачать документы' })).toBeVisible({
    timeout: 15_000,
  });

  await navigationButton(page, 'Поиск').click();
  await page.getByTestId('search-input').fill('приказ 192н диспансерное наблюдение после удаления');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results').getByText(REGULATORY_TITLE)).toHaveCount(0);

  await page.getByTestId('search-input').fill('Ребёнок часто дышит и температурит второй день');
  await page.getByTestId('search-submit').click();
  await expect(
    page.getByTestId('search-results').getByText('Внебольничная пневмония у детей').first(),
  ).toBeVisible();
});
