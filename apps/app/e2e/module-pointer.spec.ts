import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
const POINTER = 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac';
const TARGET = 'kr.rf.1006_1';
const ANCHOR =
  'kr.rf.1006_1@1006_1/1-краткая-информация/1-1-определение-заболевания-или-состояния#chunk-8f63193c';
const route = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(`${id}\n${ANCHOR}`).toString('base64url')}`;

test('downloads an exact pointer target and preserves the source anchor on reopening', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const module = catalog.modules.find(
    (entry) => entry.id === 'minimed.clinical.recommendation.1006_1',
  );
  const artifact = module?.artifacts.find((item) => item.kind === 'index');
  if (!module || !artifact?.url) throw new Error('Missing clinical fixture artifact');
  const bytes = await readFile(resolve(ROOT, 'data/build/e2e-clinical-1006-release.db'));
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  const fileName = new URL(artifact.url).pathname.split('/').at(-1);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
  );
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(route(POINTER));
  const install = page.locator('.document-module-pointer__action');
  await expect(install).toBeVisible();
  await install.click();
  await expect(page).toHaveURL(route(TARGET), { timeout: 60_000 });
  await expect(page.locator('.document-module-pointer__error')).toHaveCount(0);
  await expect(page.locator(`[id="${ANCHOR}"]`)).toBeInViewport();
  await page.goto(route(POINTER));
  await expect(page).toHaveURL(route(TARGET), { timeout: 30_000 });
  await expect(page.locator(`[id="${ANCHOR}"]`)).toBeInViewport();
});

test('a preview medication package has no download action when experiments are disabled', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: false }),
    },
  });
  const id = 'core.catalog.pointer.medication.esklp.mnn.наратриптан-488037ae33353da1';
  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`,
  );
  await expect(page.locator('.document-module-pointer__title')).toHaveText(
    'Полный документ пока недоступен',
  );
  await expect(page.locator('.document-module-pointer__action')).toHaveCount(0);
});

test('downloads the verified medication package with experiments enabled', async ({ page }) => {
  test.setTimeout(120_000);
  const moduleId = 'minimed.medications.antiparasitic.ru';
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((module) => module.id === moduleId)?.artifacts[0];
  if (!artifact) throw new Error('Missing medication fixture artifact');
  const bytes = await readFile(resolve(ROOT, `data/build/release-esklp/${moduleId}.db`));
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${moduleId}.db`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
  );
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  const documentRoute = (id: string) =>
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;
  await page.goto(
    documentRoute('core.catalog.pointer.medication.esklp.mnn.албендазол-062d3e89c1c0b8dd'),
  );
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(documentRoute('esklp.mnn.албендазол'), { timeout: 60_000 });
  await expect(page.locator('.document-text-chunk').first()).toBeVisible();
  await expect(page.locator('.document-module-pointer__error')).toHaveCount(0);
});
