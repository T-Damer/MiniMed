import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

/**
 * Since 0.6.47 the core holds only medication pointers, so medication cards exist once a medication
 * module is installed. These helpers install the smallest one (the antiparasitic ЕСКЛП group) from
 * its published bytes, kept as the local release copy (docs/data-ledger.json), and open a card.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
export const MEDICATION_MODULE_ID = 'minimed.medications.antiparasitic.ru';
const PUBLISHED_DIRECTORY = 'output/module-zstd-2026-10-01/esklp-compacted';
const POINTER = 'core.catalog.pointer.medication.esklp.mnn.албендазол-062d3e89c1c0b8dd';

const documentRoute = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

/** Serves the module's published file; call before mounting. Skips when the copy is absent. */
export async function routeMedicationModule(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((module) => module.id === MEDICATION_MODULE_ID)
    ?.artifacts[0];
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
}

/** Installs the module through its core pointer, as a doctor would, and waits for the document. */
export async function installMedicationModule(page: Page): Promise<void> {
  await page.goto(documentRoute(POINTER));
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(documentRoute('esklp.mnn.албендазол'), { timeout: 90_000 });
}

/** Opens the first product card of the medication catalog and returns its title. */
export async function openFirstMedicationCard(page: Page): Promise<string> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  const title = page.locator('.drug-header__title');
  await expect(title).toBeVisible({ timeout: 30_000 });
  const text = (await title.textContent())?.trim() ?? '';
  expect(text).not.toBe('');
  return text;
}
