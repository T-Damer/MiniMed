import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp, waitForSearchReady } from './mount-built-app';

/**
 * REG2: the bundled regulatory.db is 323-ФЗ in full text plus a card for every other act; the full
 * texts are the downloadable module `minimed.regulatory.pediatrics.ru`.
 *
 * The module comes from the local release copy (by absolute path, the main checkout's `output/`
 * when this is a worktree). With REGULATORY_E2E_MIRROR=1 the request goes to the real mirror branch
 * instead. Without either the install scenario is skipped; the card scenario needs no module.
 *
 *   E2E_PORT=4231 bunx playwright test regulatory-module --workers=1
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const CHECKOUTS = [ROOT, resolve(ROOT, '../../..')];
const MODULE_ID = 'minimed.regulatory.pediatrics.ru';
const MAIN_LAW_ID = 'regulatory.rf.federal-law.323-fz-2011';
const ACT_ID = 'regulatory.rf.minzdrav.192n-2025';
const FROM_MIRROR = process.env['REGULATORY_E2E_MIRROR'] === '1';

const catalog = ContentModuleCatalogSchema.parse(
  JSON.parse(
    readFileSync(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
  ),
);
const artifact = catalog.modules
  .find((module) => module.id === MODULE_ID)
  ?.artifacts.find((entry) => entry.kind === 'index');
const FILE_NAME = new URL(artifact?.url ?? 'https://example.test/none').pathname
  .split('/')
  .at(-1) as string;
const CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
const RELEASE_DIRECTORY = 'output/module-zstd-regulatory-2026-10-14-r2';

function localReleaseCopy(): string | undefined {
  for (const root of CHECKOUTS) {
    const path = resolve(root, RELEASE_DIRECTORY, FILE_NAME);
    if (existsSync(path)) return path;
  }
  return undefined;
}

const documentRoute = (id: string): string =>
  `#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

/**
 * The committed catalog lists the module for 0.6.60, the release that bundles the light pack; this
 * build is still 0.6.59 (release.json), so the same catalog is served with the floor lowered to it.
 */
async function serveCatalogForThisBuild(page: Page): Promise<void> {
  const raw = JSON.parse(
    readFileSync(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
  ) as {
    publishedAt: string;
    catalogVersion: string;
    modules: { id: string; compatibility: { minAppVersion: string } }[];
  };
  const release = JSON.parse(readFileSync(resolve(ROOT, 'release.json'), 'utf8')) as {
    version: string;
  };
  const module = raw.modules.find((entry) => entry.id === MODULE_ID);
  if (!module) throw new Error('The regulatory module is missing from the catalog.');
  module.compatibility.minAppVersion = release.version;
  raw.publishedAt = '2099-01-01T00:00:00Z';
  // The runtime swaps catalogs by a fingerprint that ignores `compatibility`, so the version changes too.
  raw.catalogVersion = `${raw.catalogVersion}.e2e-floor`;
  const body = JSON.stringify(raw);
  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (request) =>
      request.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body,
        headers: { ETag: '"regulatory-e2e-catalog"' },
      }),
  );
}

async function openDocument(page: Page, id: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, documentRoute(id));
}

test('opens 323-ФЗ whole and every other act as a card that offers the module', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Nothing is downloaded in this scenario: the module file must not even be requested.
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith(`/${FILE_NAME}`),
    (request) => {
      requested.push(request.request().url());
      return request.abort();
    },
  );
  await serveCatalogForThisBuild(page);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);

  await openDocument(page, MAIN_LAW_ID);
  await expect(page.getByRole('region', { name: /323-ФЗ/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /^Статья 20\. Информированное/u })).toBeVisible();
  await expect(page.locator('.document-module-pointer')).toHaveCount(0);

  await openDocument(page, ACT_ID);
  const offer = page.locator('.document-module-pointer');
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await expect(offer).toContainText('Нормативные документы РФ');
  await expect(page.locator('.document-module-pointer__action')).toContainText(/МБ|МиБ/u);
  // The card has the act's identity (title, edition, source) but not its text.
  await expect(page.getByText('Признать утратившими силу:', { exact: true })).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('an act opens in full text after the module is installed', async ({ page }) => {
  test.setTimeout(FROM_MIRROR ? 900_000 : 300_000);
  const file = FROM_MIRROR ? undefined : localReleaseCopy();
  test.skip(
    !FROM_MIRROR && !file,
    `The release copy ${RELEASE_DIRECTORY}/${FILE_NAME} is local-only and not in this checkout.`,
  );
  if (!FROM_MIRROR && file) {
    const bytes = readFileSync(file);
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact?.sha256);
    await page.route(
      (url) => url.pathname.endsWith(`/${FILE_NAME}`),
      (request) =>
        request.fulfill({
          body: bytes,
          contentType: 'application/zstd',
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
  }
  await serveCatalogForThisBuild(page);
  const catalogServed = page.waitForResponse((response) => response.url().startsWith(CATALOG_URL), {
    timeout: 90_000,
  });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  // The knowledge base asks for the catalog: the build's own (floor 0.6.60) is replaced by the
  // served one, which is what lets a 0.6.59 build install the module.
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'База знаний' }).click();
  await catalogServed;

  await openDocument(page, ACT_ID);
  const install = page.locator('.document-module-pointer__action');
  await expect(install).toBeVisible({ timeout: 60_000 });
  await install.click();

  // The same act, now whole: an item of the order's text that only the module has.
  await expect(page.getByText('Признать утратившими силу:', { exact: true })).toBeVisible({
    timeout: FROM_MIRROR ? 600_000 : 180_000,
  });
  await expect(page.locator('.document-module-pointer')).toHaveCount(0);
  await expect(page.locator('.document-module-pointer__error')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(Buffer.from(ACT_ID).toString('base64url'), 'u'));

  // The installed module replaced the card for the rest of the session: 323-ФЗ stays whole.
  await openDocument(page, MAIN_LAW_ID);
  await expect(page.getByRole('button', { name: /^Статья 20\. Информированное/u })).toBeVisible({
    timeout: 60_000,
  });
});
