import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';
import { LOCAL_DATA_ROOT } from './local-data';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// The local release copies stay in the main checkout; an agent worktree (`<main>/.claude/worktrees/…`) reads them there.
const DATA_ROOT = LOCAL_DATA_ROOT;
// Local copies of the published zstd indexes (docs/data-ledger.json keeps them as release copies).
// Newest copy first: KR-PARSE republished all 774 КР on 2026-10-25, MOD-REBUILD 358 on 2026-10-20.
const PUBLISHED_DIRECTORIES = [
  'output/module-zstd-json-2026-10-25',
  'output/module-zstd-json-2026-10-20',
  'output/module-zstd-kd1-2026-10-11',
];
const MODULE_ID = 'minimed.clinical.recommendation.1006_1';
export const CLINICAL_POINTER_ID = 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac';

export const CLINICAL_DOCUMENT_ROUTE = `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(
  'kr.rf.1006_1',
).toString('base64url')}`;

/** A clinical recommendation the fixture can serve: its module, core pointer and document id. */
export interface ClinicalTarget {
  readonly moduleId: string;
  readonly pointerId: string;
  readonly documentId: string;
}

export const DEFAULT_CLINICAL_TARGET: ClinicalTarget = {
  moduleId: MODULE_ID,
  pointerId: CLINICAL_POINTER_ID,
  documentId: 'kr.rf.1006_1',
};

/** «Пневмония у детей»: its PDF starts with a printed table of contents. */
export const PNEUMONIA_CHILDREN_TARGET: ClinicalTarget = {
  moduleId: 'minimed.clinical.recommendation.714_2',
  pointerId: 'core.catalog.pointer.clinical.kr.rf.714_2-bdda529a738d527d',
  documentId: 'kr.rf.714_2',
};

/**
 * Serves the published bytes of one clinical-recommendation module («Острая ишемия конечностей»)
 * to the app, so reader tests have a full document now that the core holds only pointers (0.6.47).
 * Call before `mountBuiltApp`; skips the test when the local release copy is absent.
 */
export async function routeClinicalModule(
  page: Page,
  target: ClinicalTarget = DEFAULT_CLINICAL_TARGET,
): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules
    .find((module) => module.id === target.moduleId)
    ?.artifacts.find((item) => item.kind === 'index');
  if (!artifact?.url) throw new Error(`Missing ${target.moduleId} artifact`);
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath =
    PUBLISHED_DIRECTORIES.map((directory) => resolve(DATA_ROOT, directory, fileName)).find((path) =>
      existsSync(path),
    ) ?? resolve(DATA_ROOT, PUBLISHED_DIRECTORIES[0] ?? '', fileName);
  test.skip(!existsSync(localPath), `The published module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
}

/** Installs the routed module from its core pointer and waits for the full document to open. */
export async function installClinicalModule(
  page: Page,
  target: ClinicalTarget = DEFAULT_CLINICAL_TARGET,
): Promise<void> {
  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(target.pointerId).toString('base64url')}`,
  );
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(target.documentId).toString('base64url')}`,
    { timeout: 90_000 },
  );
}
