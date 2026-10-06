import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// TOOLS1b: the age-scope rebuild (c67cd124) gave every tool module a new version. A device that
// installed the previous version must pick the new one up by itself, and until it has, the screens
// must stay usable instead of failing on definitions that predate `ageScope`.

const APP_ROOT = resolve(import.meta.dirname, '..');
const CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
const REGISTRY_KEY = 'localmed.installed-modules.v1';
const MODULE_ID = 'minimed.tools.core-clinical.ru';
const OLD_VERSION = '0.1.0-preview.3';
// Mosteller's body-surface-area calculator lives in this module.
const CALCULATOR_ROUTE = '#/calculators/body-surface-area-mosteller';

interface CatalogArtifact {
  id: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  sourceSetDigest: string;
}
interface CatalogModule {
  id: string;
  version: string;
  sourceSetDigest: string;
  sizes: { downloadBytes: number; installedBytes: number };
  artifacts: CatalogArtifact[];
}
interface Catalog {
  publishedAt: string;
  modules: CatalogModule[];
}

// The previous release is a test fixture, not a shipped module: the app bundle carries only the
// versions the catalog points at.
const oldBytes = readFileSync(
  resolve(APP_ROOT, `e2e/fixtures/minimed-tools-${MODULE_ID.split('.')[2]}-${OLD_VERSION}.db`),
);
const currentCatalog = JSON.parse(
  readFileSync(resolve(APP_ROOT, 'src/features/modules/catalog.preview.json'), 'utf8'),
) as Catalog;

function sha(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The catalog as it was before the rebuild: the module at the old version with the old bytes. */
function catalogWithOldModule(): string {
  const catalog = structuredClone(currentCatalog);
  const module = catalog.modules.find((entry) => entry.id === MODULE_ID);
  const artifact = module?.artifacts[0];
  if (!module || !artifact) throw new Error(`${MODULE_ID} is missing from the catalog.`);
  module.version = OLD_VERSION;
  module.sourceSetDigest = sha(oldBytes);
  module.sizes.downloadBytes = oldBytes.byteLength;
  module.sizes.installedBytes = oldBytes.byteLength;
  artifact.id = `${MODULE_ID}-index-${OLD_VERSION}`;
  artifact.url = `https://tool-modules.example.test/old/${MODULE_ID}-${OLD_VERSION}.db`;
  artifact.sha256 = sha(oldBytes);
  artifact.sizeBytes = oldBytes.byteLength;
  artifact.sourceSetDigest = module.sourceSetDigest;
  catalog.publishedAt = '2099-01-01T00:00:00Z';
  return JSON.stringify(catalog);
}

/** The shipped catalog, announced as newer than anything cached on the device. */
function shippedCatalog(): string {
  return JSON.stringify({ ...currentCatalog, publishedAt: '2100-01-01T00:00:00Z' });
}

async function installedVersion(page: Page): Promise<string | undefined> {
  return page.evaluate(
    ([key, moduleId]) => {
      const raw = window.localStorage.getItem(key ?? '');
      if (!raw) return undefined;
      const registry = JSON.parse(raw) as {
        entries?: Array<{ moduleId?: string; active?: { version?: string } }>;
      };
      return registry.entries?.find((entry) => entry.moduleId === moduleId)?.active?.version;
    },
    [REGISTRY_KEY, MODULE_ID],
  );
}

async function installOldModule(page: Page): Promise<void> {
  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: catalogWithOldModule(),
      }),
  );
  await page.route('https://tool-modules.example.test/old/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: oldBytes,
      headers: { 'Content-Length': String(oldBytes.byteLength) },
    }),
  );
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/collection/tool';
  });
  // Package status is checked once the medical core has opened.
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );
  const card = page.locator('article', { hasText: 'Базовые клинические расчёты' }).first();
  await expect(card).toContainText(OLD_VERSION);
  await card.getByRole('button', { name: /^Скачать/u }).click();
  await expect.poll(() => installedVersion(page), { timeout: 30_000 }).toBe(OLD_VERSION);
}

async function reloadWithShippedCatalog(page: Page): Promise<void> {
  // The device now receives the shipped catalog; the old bytes are no longer served.
  await page.unroute((url) => url.href.startsWith(CATALOG_URL));
  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: shippedCatalog(),
      }),
  );
  await page.evaluate(async () => {
    // The device's cached catalog is the old one; forget it so the shipped one is what it sees.
    await new Promise<void>((resolveDelete, rejectDelete) => {
      const request = indexedDB.deleteDatabase('minimed-module-catalog');
      request.onsuccess = () => resolveDelete();
      request.onerror = () => rejectDelete(request.error);
      request.onblocked = () => rejectDelete(new Error('The catalog cache database stayed open.'));
    });
    window.location.hash = '#/search';
  });
  await page.reload();
  await page.getByTestId('search-input').waitFor();
}

const SHIPPED_VERSION = currentCatalog.modules.find((entry) => entry.id === MODULE_ID)?.version;

test('an older installed tool module updates itself to the shipped version and opens with age badges', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installOldModule(page);
  await reloadWithShippedCatalog(page);

  expect(SHIPPED_VERSION).not.toBe(OLD_VERSION);
  await expect.poll(() => installedVersion(page), { timeout: 60_000 }).toBe(SHIPPED_VERSION);

  await page.evaluate((route) => {
    window.location.hash = route;
  }, CALCULATOR_ROUTE);
  await expect(page.locator('.calculator-pack-required')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Площадь поверхности тела — Mosteller' }),
  ).toBeVisible();

  // The module's calculators are listed with the age they are for.
  await page.evaluate(() => {
    window.location.hash = '#/calculators/section/renal';
  });
  const ckid = page.locator('.calculator-card', { hasText: 'CKiD' }).first();
  await expect(ckid.locator('.tool-age-badge')).toBeVisible();
  await expect(ckid.locator('.tool-age-badge')).toHaveAttribute('data-age-tone', 'children');
  await expect(page.locator('.error-card')).toHaveCount(0);
});

test('while the update cannot be fetched, an older installed tool module offers it and nothing breaks', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installOldModule(page);
  await page.route(
    `**/content/modules/minimed-tools-core-clinical-${SHIPPED_VERSION}.db`,
    (route) => route.abort('internetdisconnected'),
  );
  await reloadWithShippedCatalog(page);
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );

  // Not updated, not broken: the tool says it needs its section and offers the download.
  await page.evaluate((route) => {
    window.location.hash = route;
  }, CALCULATOR_ROUTE);
  const required = page.locator('.calculator-pack-required');
  await expect(required).toBeVisible();
  await expect(page.locator('.error-card')).toHaveCount(0);
  expect(await installedVersion(page)).toBe(OLD_VERSION);

  await page.evaluate(() => {
    window.location.hash = '#/calculators';
  });
  await expect(page.getByText('Есть обновление').first()).toBeVisible();
  await expect(page.locator('.error-card')).toHaveCount(0);

  // The normal update action works once the network returns.
  await page.unroute(`**/content/modules/minimed-tools-core-clinical-${SHIPPED_VERSION}.db`);
  await page.evaluate((route) => {
    window.location.hash = route;
  }, CALCULATOR_ROUTE);
  await required.getByRole('button', { name: 'Скачать', exact: true }).click();
  await expect.poll(() => installedVersion(page), { timeout: 60_000 }).toBe(SHIPPED_VERSION);
  await expect(required).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: 'Площадь поверхности тела — Mosteller' }),
  ).toBeVisible();
});
