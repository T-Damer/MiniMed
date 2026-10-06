import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { selectSearchSection } from './select-search-section';

/**
 * The optional WHO ICD-11 module is installed from its locally built release bytes (the module is
 * built by `bun run content:module:icd11`; its release asset is not in git), then its cards are
 * searched, labelled and opened. ICD-10 stays the default coding system: ICD-11 is searched only in
 * «Все источники» and never in the ICD-10 section.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const MODULE_ID = 'minimed.reference.icd11.ru';
const RELEASE_DIRECTORY = 'data/build/icd11-module/release';
const RESULT_LABEL = 'МКБ-11 (ВОЗ), справочно';
const MODULE_TITLE = 'МКБ-11 (ВОЗ), справочно; в РФ действует МКБ-10';

async function routeIcd11Module(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((entry) => entry.id === MODULE_ID)?.artifacts[0];
  if (!artifact?.url) throw new Error('The ICD-11 module is not in the catalog preview');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(ROOT, RELEASE_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The ICD-11 release file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
  );
}

async function installIcd11Module(page: Page): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/collection/icd11`);
  const card = page.locator('.module-card', { hasText: MODULE_TITLE });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('МКБ-10');
  await card.getByRole('button', { name: 'Скачать Experimental' }).click();
  const installed = card.getByRole('button', { name: /^Удалить «МКБ-11/u });
  const failed = card.getByRole('button', { name: 'Ошибка при загрузке' });
  await expect(installed.or(failed)).toBeVisible({ timeout: 240_000 });
  if (await failed.isVisible()) {
    await failed.click();
    throw new Error(
      `Module install failed: ${(await page.locator('body').innerText()).slice(0, 1500)}`,
    );
  }
}

async function search(page: Page, query: string): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/`);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
}

test('installs the optional МКБ-11 module, labels its results and opens a card', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeIcd11Module(page);
  await mountBuiltApp(page, { persistentOrigin: true });
  await installIcd11Module(page);

  await search(page, '1A00 холера');
  const group = page
    .getByTestId('search-results')
    .locator('.result-group')
    .filter({ has: page.locator('.result-group-header__kind-label', { hasText: RESULT_LABEL }) })
    .first();
  await expect(group).toBeVisible({ timeout: 60_000 });
  await expect(group.locator('.result-group-header__title')).toContainText('МКБ-11 (ВОЗ)');
  await expect(group.locator('.result-group-header__title')).toContainText('1A00');
  await group.locator('.result-group-header').click();
  const panel = page.getByTestId('icd11-card-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText(RESULT_LABEL);
  await expect(panel).toContainText('В Российской Федерации действует МКБ-10');
  await expect(panel).toContainText('A00.9');
  await expect(panel).toContainText('1A00&XN8P1');
  await expect(page.locator('.document-overlay-paper__title')).toContainText('1A00 Холера');
  await expect(page.locator('.document-overlay-paper')).toContainText(
    'Название ВОЗ на английском: Cholera',
  );
  // WHO's Russian definition, inclusions and index terms come from the ICD-API (merged text).
  await expect(page.locator('.document-overlay-paper')).toContainText('Определение: Холера');
  await expect(page.locator('.document-overlay-paper')).toContainText('Термины указателя');
  await expect(page.locator('.document-overlay-paper')).toContainText('азиатская холера');

  const parent = panel.getByRole('navigation', { name: 'Вышестоящие рубрики МКБ-11' });
  await parent.getByRole('link').first().click();
  await expect(page.locator('.document-overlay-paper__title')).toContainText('Блок:');
  await expect(page.locator('.document-overlay-paper__title')).toContainText('(МКБ-11)');
  await expect(page.locator('.document-overlay-paper__title')).not.toContainText('1A00 Холера');
  await expect(page.getByTestId('icd11-card-panel')).toBeVisible();
});

test('finds a card through a WHO Russian index term that is not in its title', async ({ page }) => {
  test.setTimeout(300_000);
  await routeIcd11Module(page);
  await mountBuiltApp(page, { persistentOrigin: true });
  await installIcd11Module(page);

  await search(page, 'азиатская холера');
  const group = page
    .getByTestId('search-results')
    .locator('.result-group')
    .filter({ has: page.locator('.result-group-header__kind-label', { hasText: RESULT_LABEL }) })
    .filter({ has: page.locator('.result-group-header__title', { hasText: '1A00' }) })
    .first();
  await expect(group).toBeVisible({ timeout: 60_000 });
});

test('never offers ICD-11 cards in the ICD-10 section or as an ICD-10 code', async ({ page }) => {
  test.setTimeout(300_000);
  await routeIcd11Module(page);
  await mountBuiltApp(page, { persistentOrigin: true });
  await installIcd11Module(page);

  await page.goto(`${E2E_ASSET_ORIGIN}/#/`);
  await selectSearchSection(page, 'МКБ, симптомы и состояния');
  await page.getByTestId('search-input').fill('1A00 холера');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.locator('.result-group-header__kind-label', { hasText: RESULT_LABEL }),
  ).toHaveCount(0);
  await expect(page.getByTestId('search-results')).not.toContainText('МКБ-11 (ВОЗ)');

  await selectSearchSection(page, 'Все источники');
  await page.getByTestId('search-input').fill('A00');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  // An ICD-10 code query may list ICD-11 cards through their crosswalk, but never unlabelled:
  // every card titled «МКБ-11» carries the ICD-11 label, and no other card does.
  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 60_000 });
  const groups = page.locator('.result-group');
  const unlabelledIcd11 = groups
    .filter({ has: page.locator('.result-group-header__title', { hasText: 'МКБ-11 (ВОЗ)' }) })
    .filter({
      hasNot: page.locator('.result-group-header__kind-label', { hasText: RESULT_LABEL }),
    });
  await expect(unlabelledIcd11).toHaveCount(0);
  const mislabelled = groups
    .filter({ has: page.locator('.result-group-header__kind-label', { hasText: RESULT_LABEL }) })
    .filter({
      hasNot: page.locator('.result-group-header__title', { hasText: 'МКБ-11 (ВОЗ)' }),
    });
  await expect(mislabelled).toHaveCount(0);
});
