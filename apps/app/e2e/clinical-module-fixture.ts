import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Local copies of the published zstd indexes (docs/data-ledger.json keeps them as release copies):
// the KR4 rebuild with appendix headings first, then the KR3 rebuild with numbered sub-headings, then
// the E2 e5 release for modules both left alone.
const PUBLISHED_DIRECTORIES = [
  'output/module-zstd-json-2026-10-08',
  'output/module-zstd-json-2026-10-07',
  'output/module-zstd-e5-2026-10-05',
];
const MODULE_ID = 'minimed.clinical.recommendation.1006_1';
export const CLINICAL_POINTER_ID = 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac';

export const CLINICAL_DOCUMENT_ROUTE = `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(
  'kr.rf.1006_1',
).toString('base64url')}`;

/**
 * Serves the published bytes of one clinical-recommendation module («Острая ишемия конечностей»)
 * to the app, so reader tests have a full document now that the core holds only pointers (0.6.47).
 * Call before `mountBuiltApp`; skips the test when the local release copy is absent.
 */
export async function routeClinicalModule(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules
    .find((module) => module.id === MODULE_ID)
    ?.artifacts.find((item) => item.kind === 'index');
  if (!artifact?.url) throw new Error(`Missing ${MODULE_ID} artifact`);
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath =
    PUBLISHED_DIRECTORIES.map((directory) => resolve(ROOT, directory, fileName)).find((path) =>
      existsSync(path),
    ) ?? resolve(ROOT, PUBLISHED_DIRECTORIES[0] ?? '', fileName);
  test.skip(!existsSync(localPath), `The published module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
}

/** Installs the routed module from its core pointer and waits for the full document to open. */
export async function installClinicalModule(page: Page): Promise<void> {
  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(CLINICAL_POINTER_ID).toString('base64url')}`,
  );
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(CLINICAL_DOCUMENT_ROUTE, { timeout: 90_000 });
}
