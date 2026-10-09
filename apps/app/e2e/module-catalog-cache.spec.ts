import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

import { mountBuiltApp, waitForSearchReady } from './mount-built-app';

// CAT1: the remote module catalog is several megabytes. It used to be cached in localStorage,
// which refuses that size, so the cache never persisted: every start downloaded the catalog again
// and an offline start fell back to the bundled one. It now lives in IndexedDB with its validators.

const APP_ROOT = resolve(import.meta.dirname, '..');
const CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
const LEGACY_KEY = 'minimed.content-module-catalog.preview.v1';
const DATABASE = 'minimed-module-catalog';
const ETAG = 'W/"catalog-1"';
const EXTRA_MODULES = 3;

interface CatalogModule {
  id: string;
  releaseState: string;
  tags: string[];
  artifacts: Array<{ id: string }>;
  documents: unknown[];
  documentTable?: unknown;
  previewDocumentCount: number;
}
interface Catalog {
  publishedAt: string;
  catalogVersion: string;
  modules: CatalogModule[];
}

const bundled = JSON.parse(
  readFileSync(resolve(APP_ROOT, 'src/features/modules/catalog.preview.json'), 'utf8'),
) as Catalog;
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(APP_ROOT, '../../release.json'), 'utf8')) as {
    version: string;
  }
).version;

function counted(module: CatalogModule): boolean {
  return module.releaseState === 'published' && !module.tags.includes('individual-recommendation');
}

/** The catalog with extra published modules, so the nav badge tells which catalog is active. */
function catalogWithExtras(publishedAt: string, extras: number): string {
  const template = bundled.modules.find(counted);
  if (!template) throw new Error('The bundled catalog has no published module to clone.');
  const modules = [...bundled.modules];
  for (let index = 0; index < extras; index += 1) {
    const clone = structuredClone(template);
    clone.id = `${template.id}.e2e-${index}`;
    for (const artifact of clone.artifacts) artifact.id = `${artifact.id}.e2e-${index}`;
    // Documents point at artifacts by id; the clones only need to be countable modules.
    clone.documents = [];
    delete clone.documentTable;
    clone.previewDocumentCount = 0;
    modules.push(clone);
  }
  return JSON.stringify({ ...bundled, publishedAt, modules });
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'etag, last-modified',
};

interface ServedRequest {
  readonly conditional: string | null;
  readonly status: number;
}

/** A catalog server with ETag validators. Every GET it answers is recorded. */
async function serveCatalog(
  page: Page,
  body: () => string,
  options: { readonly etag?: string; readonly alwaysNotModified?: boolean } = {},
): Promise<ServedRequest[]> {
  const served: ServedRequest[] = [];
  const etag = options.etag ?? ETAG;
  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    async (route: Route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const conditional = (await request.allHeaders())['if-none-match'] ?? null;
      if (conditional !== null && (options.alwaysNotModified || conditional === etag)) {
        served.push({ conditional, status: 304 });
        await route.fulfill({ status: 304, headers: { ...CORS, etag } });
        return;
      }
      served.push({ conditional, status: 200 });
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: { ...CORS, etag },
        body: body(),
      });
    },
  );
  return served;
}

async function availableCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    for (const button of document.querySelectorAll('.app-nav-button')) {
      const match = /доступно: (\d+)/u.exec(button.getAttribute('aria-label') ?? '');
      if (match?.[1]) return Number(match[1]);
    }
    return null;
  });
}

async function storedRecord(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown> | null>((resolveRecord, rejectRecord) => {
        const open = indexedDB.open(name);
        open.onerror = () => rejectRecord(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('records')) {
            database.close();
            resolveRecord(null);
            return;
          }
          const get = database.transaction('records').objectStore('records').get('preview');
          get.onerror = () => rejectRecord(get.error);
          get.onsuccess = () => {
            database.close();
            resolveRecord((get.result as Record<string, unknown> | undefined) ?? null);
          };
        };
      }),
    DATABASE,
  );
}

async function seedRecord(page: Page, record: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ([name, value]) =>
      new Promise<void>((resolveSeed, rejectSeed) => {
        const open = indexedDB.open(name as string, 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('records', { keyPath: 'key' });
        };
        open.onerror = () => rejectSeed(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('records', 'readwrite');
          transaction.objectStore('records').put(value);
          transaction.oncomplete = () => {
            database.close();
            resolveSeed();
          };
          transaction.onerror = () => rejectSeed(transaction.error);
        };
      }),
    [DATABASE, record] as const,
  );
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.getByTestId('search-input').waitFor();
}

/** Starts the app with the catalog unreachable: the database exists but is empty. Returns the badge count of the bundled catalog. */
async function mountWithCatalogUnreachable(page: Page): Promise<number> {
  const matches = (url: URL): boolean => url.href.startsWith(CATALOG_URL);
  await page.route(matches, (route) => route.abort('internetdisconnected'));
  await mountBuiltApp(page);
  await waitForSearchReady(page);
  // Bundled modules plus the terminology the app merges in: what the badge shows without a remote.
  await expect.poll(() => availableCount(page)).toBeGreaterThan(0);
  const baseline = (await availableCount(page)) ?? 0;
  await page.unroute(matches);
  return baseline;
}

test('the catalog is cached once, then revalidated with a 304 and stays the remote one', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, '{"retired":true}');
  }, LEGACY_KEY);
  const bundledCount = await mountWithCatalogUnreachable(page);
  const served = await serveCatalog(page, () =>
    catalogWithExtras('2100-01-01T00:00:00Z', EXTRA_MODULES),
  );
  await reload(page);

  await expect.poll(() => availableCount(page)).toBe(bundledCount + EXTRA_MODULES);
  await expect
    .poll(() => storedRecord(page))
    .toMatchObject({
      etag: ETAG,
      appVersion: APP_VERSION,
      publishedAt: '2100-01-01T00:00:00Z',
    });
  expect(typeof (await storedRecord(page))?.['catalogJson']).toBe('string');
  // The retired localStorage record is gone.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)).toBeNull();
  expect(served).toEqual([{ conditional: null, status: 200 }]);

  await reload(page);
  await expect.poll(() => served.length).toBe(2);
  expect(served[1]).toEqual({ conditional: ETAG, status: 304 });
  await expect.poll(() => availableCount(page)).toBe(bundledCount + EXTRA_MODULES);
});

test('an offline start still uses the cached remote catalog', async ({ page }) => {
  test.setTimeout(120_000);
  const bundledCount = await mountWithCatalogUnreachable(page);
  const served = await serveCatalog(page, () =>
    catalogWithExtras('2100-01-01T00:00:00Z', EXTRA_MODULES),
  );
  await reload(page);
  await expect.poll(() => availableCount(page)).toBe(bundledCount + EXTRA_MODULES);
  expect(served).toHaveLength(1);

  await page.unroute((url) => url.href.startsWith(CATALOG_URL));
  await page.route(
    (url) => url.href.startsWith(CATALOG_URL),
    (route) => route.abort('internetdisconnected'),
  );
  await reload(page);

  await expect.poll(() => availableCount(page)).toBe(bundledCount + EXTRA_MODULES);
});

test('after an app update a newer bundled catalog beats an older cached one', async ({ page }) => {
  test.setTimeout(120_000);
  const bundledCount = await mountWithCatalogUnreachable(page);
  // Any request that carries a validator is answered 304; the full body is not newer than the
  // catalog this app ships.
  const served = await serveCatalog(page, () => catalogWithExtras(bundled.publishedAt, 0), {
    alwaysNotModified: true,
  });
  // The device holds a catalog older than the one this app ships, written by the same app version
  // (so its validators are trusted): the 304 must not make the stale cache win.
  await seedRecord(page, {
    key: 'preview',
    format: 2,
    appVersion: APP_VERSION,
    publishedAt: '2026-01-01T00:00:00Z',
    etag: ETAG,
    lastModified: null,
    fetchedAt: '2026-01-01T00:00:00Z',
    catalogJson: catalogWithExtras('2026-01-01T00:00:00Z', EXTRA_MODULES),
  });
  await reload(page);

  await expect.poll(() => served.length).toBeGreaterThan(0);
  expect(served[0]).toEqual({ conditional: ETAG, status: 304 });
  await expect.poll(() => availableCount(page)).toBe(bundledCount);
});

test('a cache written by another app version is revalidated without its validators', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bundledCount = await mountWithCatalogUnreachable(page);
  const served = await serveCatalog(page, () => catalogWithExtras('2100-01-01T00:00:00Z', 1), {
    alwaysNotModified: true,
  });
  await seedRecord(page, {
    key: 'preview',
    format: 2,
    appVersion: '0.0.1',
    publishedAt: '2099-01-01T00:00:00Z',
    etag: ETAG,
    lastModified: null,
    fetchedAt: '2026-01-01T00:00:00Z',
    catalogJson: catalogWithExtras('2099-01-01T00:00:00Z', EXTRA_MODULES),
  });
  await reload(page);

  await expect.poll(() => served.length).toBeGreaterThan(0);
  expect(served[0]).toEqual({ conditional: null, status: 200 });
  await expect.poll(() => availableCount(page)).toBe(bundledCount + 1);
});
