import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';

export const E2E_ASSET_ORIGIN = 'https://localmed-assets.example.com';
const DIST_ROOT = resolve(import.meta.dirname, '../dist');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

async function serveBuiltAsset(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = normalize(join(DIST_ROOT, requestedPath));
  const pathFromRoot = relative(DIST_ROOT, filePath);

  if (pathFromRoot.startsWith('..') || pathFromRoot.includes('/../')) {
    await route.fulfill({ status: 400, body: 'Invalid asset path.' });
    return;
  }

  try {
    const body = await readFile(filePath);
    await route.fulfill({
      status: 200,
      body,
      contentType: CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch {
    await route.fulfill({ status: 404, body: `Asset not found: ${requestedPath}` });
  }
}

export interface MountBuiltAppOptions {
  readonly localStorage?: Readonly<Record<string, string>>;
  readonly persistentOrigin?: boolean;
}

export async function mountBuiltApp(page: Page, options: MountBuiltAppOptions = {}): Promise<void> {
  await page.route(`${E2E_ASSET_ORIGIN}/**`, serveBuiltAsset);

  if (options.persistentOrigin) {
    await page.addInitScript((initialValues) => {
      for (const [key, value] of Object.entries(initialValues)) {
        window.localStorage.setItem(key, value);
      }
    }, options.localStorage ?? {});
    await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('search-input').waitFor();
    return;
  }

  // Fast UI tests use about:blank because no persistent browser storage is needed. Opaque origins deny
  // Web Storage, so a standards-shaped in-memory implementation is installed for those tests.
  await page.evaluate((initialValues) => {
    const createStorage = (): Storage => {
      const values = new Map<string, string>();
      return {
        get length() {
          return values.size;
        },
        clear() {
          values.clear();
        },
        getItem(key) {
          return values.get(String(key)) ?? null;
        },
        key(index) {
          return [...values.keys()][index] ?? null;
        },
        removeItem(key) {
          values.delete(String(key));
        },
        setItem(key, value) {
          values.set(String(key), String(value));
        },
      };
    };

    const localStorageValue = createStorage();
    for (const [key, value] of Object.entries(initialValues)) {
      localStorageValue.setItem(key, value);
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageValue,
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createStorage(),
    });
  }, options.localStorage ?? {});

  const source = await readFile(join(DIST_ROOT, 'index.html'), 'utf8');
  const html = source.replace('<head>', `<head><base href="${E2E_ASSET_ORIGIN}/">`);
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('search-input').waitFor();
}
