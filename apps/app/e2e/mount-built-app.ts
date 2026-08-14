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
  readonly skipLargeCompanionPacks?: boolean;
  readonly includeMkbCompanionPack?: boolean;
}

async function waitForWorkspace(page: Page): Promise<void> {
  await page.getByTestId('search-input').waitFor();

  // The knowledge-base badge deliberately extends the accessible label with an update count. Most
  // navigation tests are not testing that badge, so keep their exact-name helpers deterministic while
  // leaving the production DOM and dedicated badge behaviour untouched.
  await page.locator('.app-nav-button').evaluateAll((buttons) => {
    for (const button of buttons) {
      const label = button.getAttribute('aria-label');
      if (label?.startsWith('База знаний,')) button.setAttribute('aria-label', 'База знаний');
    }
  });
}

export async function mountBuiltApp(page: Page, options: MountBuiltAppOptions = {}): Promise<void> {
  await page.route(`${E2E_ASSET_ORIGIN}/**`, serveBuiltAsset);
  if (!options.includeMkbCompanionPack) {
    await page.route(`${E2E_ASSET_ORIGIN}/content/mkb.db`, (route) => route.abort());
  }
  if (options.skipLargeCompanionPacks) {
    for (const databaseName of ['ambulatory.db', 'medications.db']) {
      await page.route(`${E2E_ASSET_ORIGIN}/content/${databaseName}`, (route) => route.abort());
    }
  }
  const initialStorage = options.localStorage ?? {};
  await page.addInitScript((initialValues) => {
    for (const [key, value] of Object.entries(initialValues)) {
      window.localStorage.setItem(key, value);
    }
  }, initialStorage);
  await page.goto(`${E2E_ASSET_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
}
