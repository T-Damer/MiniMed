import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
const MODULE_ID = 'minimed.medications.antiparasitic.ru';
// Local copy of the published zstd index (docs/data-ledger.json keeps it as the release copy).
const PUBLISHED_DIRECTORY = 'output/module-zstd-2026-10-01/esklp-compacted';
const POINTER = 'core.catalog.pointer.medication.esklp.mnn.албендазол-062d3e89c1c0b8dd';

const documentRoute = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

// Since 0.6.47 the core holds only pointers, so the medication catalog lists products once a
// medication module is installed; this installs the smallest one from its published bytes.
test('a medication card keeps its catalog product after a page reload', async ({ page }) => {
  test.setTimeout(180_000);
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((module) => module.id === MODULE_ID)?.artifacts[0];
  if (!artifact?.url) throw new Error('Missing medication module artifact');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(ROOT, PUBLISHED_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The published module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );

  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(documentRoute(POINTER));
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(documentRoute('esklp.mnn.албендазол'), { timeout: 90_000 });

  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });

  const productTitle = page.locator('.drug-header__title');
  await expect(productTitle).toBeVisible({ timeout: 30_000 });
  const heading = (await productTitle.textContent())?.trim() ?? '';
  expect(heading).not.toBe('');
  const openedUrl = page.url();

  await page.reload();

  expect(page.url()).toBe(openedUrl);
  await expect(productTitle).toHaveText(heading, { timeout: 30_000 });
});
