import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

const DIST_ROOT = join(process.cwd(), 'apps/app/dist');
const ASSET_ORIGIN = 'https://localmed.test';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

export async function mountBuiltApp(page: Page): Promise<void> {
  await page.route(`${ASSET_ORIGIN}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const filePath = join(DIST_ROOT, pathname.replace(/^\//u, ''));
    try {
      const body = await readFile(filePath);
      const extension = filePath.split('.').pop();
      const contentType =
        extension === 'js'
          ? 'text/javascript'
          : extension === 'css'
            ? 'text/css'
            : extension === 'wasm'
              ? 'application/wasm'
              : extension === 'json'
                ? 'application/json'
                : 'text/html';
      await route.fulfill({ status: 200, body, contentType });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });

  await page.addInitScript(() => {
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
          return values.get(key) ?? null;
        },
        key(index) {
          return [...values.keys()][index] ?? null;
        },
        removeItem(key) {
          values.delete(key);
        },
        setItem(key, value) {
          values.set(key, String(value));
        },
      };
    };

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createStorage(),
    });
  });

  const source = await readFile(join(DIST_ROOT, 'index.html'), 'utf8');
  const html = source.replace('<head>', `<head><base href="${ASSET_ORIGIN}/">`);
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('search-input').waitFor();
}
