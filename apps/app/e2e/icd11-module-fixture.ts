import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';

import { LOCAL_DATA_ROOT } from './local-data';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

/**
 * The optional WHO ICD-11 module for specs: served from its locally built release bytes (built by
 * `bun run content:module:icd11`; the release asset is not in git) and installed from its card on
 * the modules page. Specs call these inside a test, so a missing local file skips the test.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
export const ICD11_MODULE_ID = 'minimed.reference.icd11.ru';
const RELEASE_DIRECTORY = 'data/build/icd11-module/release';
export const ICD11_RESULT_LABEL = 'МКБ-11 (ВОЗ), справочно';
export const ICD11_MODULE_TITLE = 'МКБ-11 (ВОЗ), справочно; в РФ действует МКБ-10';

export async function routeIcd11Module(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((entry) => entry.id === ICD11_MODULE_ID)?.artifacts[0];
  if (!artifact?.url) throw new Error('The ICD-11 module is not in the catalog preview');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(LOCAL_DATA_ROOT, RELEASE_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The ICD-11 release file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
  );
}

export async function installIcd11Module(page: Page): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/collection/icd11`);
  const card = page.locator('.module-card', { hasText: ICD11_MODULE_TITLE });
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
