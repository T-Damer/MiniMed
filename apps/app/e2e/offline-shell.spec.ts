import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';

import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const SHELL_CACHE_PREFIX = 'minimed-shell-';
const CHUNK_RELOAD_KEY = 'minimed:chunk-reload:v1';

/** Waits until the worker has precached the build and controls this page; returns the cache name. */
async function waitForShellCache(page: Page): Promise<string> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 120_000,
    })
    .toBe(true);
  const names = await page.evaluate(() => caches.keys());
  const shell = names.find((name) => name.startsWith(SHELL_CACHE_PREFIX));
  if (!shell) throw new Error(`No shell cache among ${names.join(', ')}`);
  return shell;
}

async function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
}

test.describe('the app shell works offline (service worker)', () => {
  test.use({ serviceWorkers: 'allow' });

  test('an installed document opens after an offline reload', async ({ context, page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await routeClinicalModule(page);
    await mountBuiltApp(page);
    await waitForShellCache(page);

    await installClinicalModule(page);
    await page.locator('.document-overlay-section__title').first().waitFor();
    const isolatedOnline = await page.evaluate(() => crossOriginIsolated);

    // The shell is in Cache Storage, with the three small files the core needs to open at start.
    // The core, the modules and every other pack are in OPFS and never in Cache Storage.
    const paths = await cachedPaths(page);
    expect(paths).toContain('/index.html');
    expect(paths.some((path) => /\/assets\/DocumentPageHost-[\w-]+\.js$/u.test(path))).toBe(true);
    expect(paths.some((path) => /\/assets\/safety-document-[\w-]+\.js$/u.test(path))).toBe(true);
    expect(paths.some((path) => /\/assets\/atc-names-[\w-]+\.js$/u.test(path))).toBe(true);
    expect(paths.filter((path) => path.includes('/content/')).sort()).toEqual([
      '/content/core-report.json',
      '/content/reference.db',
      '/content/regulatory.db',
    ]);

    await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
    await page.getByTestId('search-input').waitFor();
    await context.setOffline(true);
    const failedAssets: string[] = [];
    page.on('requestfailed', (request) => {
      if (request.url().includes('/assets/')) failedAssets.push(request.url());
    });

    await page.reload();
    await page.getByTestId('search-input').waitFor();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    // Cross-origin isolation (COOP/COEP of the host) survives the cached page.
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(isolatedOnline);

    await page.evaluate((route) => {
      location.hash = new URL(route).hash;
    }, CLINICAL_DOCUMENT_ROUTE);
    await expect(page.locator('.document-overlay-section__title').first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('lazy-load-error')).toHaveCount(0);
    expect(failedAssets).toEqual([]);
  });
});

interface Proxy {
  readonly origin: string;
  /** Serve this body for `/sw.js` from now on, as a deploy of a new build would. */
  publishWorker(body: string): void;
  close(): Promise<void>;
}

/** Forwards to the preview server and can replace sw.js, standing in for a new deploy. */
async function startDeployProxy(target: string): Promise<Proxy> {
  let worker: string | undefined;
  const upstream = new URL(target);
  const server: Server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', target);
    if (worker !== undefined && url.pathname === '/sw.js') {
      outgoing.writeHead(200, {
        'content-type': 'text/javascript',
        'cache-control': 'no-cache',
      });
      outgoing.end(worker);
      return;
    }
    const forwarded = httpRequest(
      url,
      { method: incoming.method, headers: { ...incoming.headers, host: upstream.host } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on('error', () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    publishWorker: (body) => {
      worker = body;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test.describe('a new build is offered, never forced', () => {
  test.use({ serviceWorkers: 'allow' });

  test('installs in the background, asks, and switches only on «Обновить»', async ({ page }) => {
    test.setTimeout(300_000);
    const proxy = await startDeployProxy(E2E_ASSET_ORIGIN);
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await mountBuiltApp(page, { origin: proxy.origin });
      const firstCache = await waitForShellCache(page);
      const loadedAt = await page.evaluate(() => performance.timeOrigin);

      // The same files under a new build id: byte-different sw.js, so a new worker installs.
      const current = await (await fetch(`${E2E_ASSET_ORIGIN}/sw.js`)).text();
      const nextId = 'feedfacec0de';
      const nextCache = `${SHELL_CACHE_PREFIX}${nextId}`;
      expect(current).toMatch(/"id":"[0-9a-f]{12}"/u);
      proxy.publishWorker(current.replace(/"id":"[0-9a-f]{12}"/u, `"id":"${nextId}"`));
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });

      await expect(page.getByText('Доступно обновление')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('app-update-nav-hint')).toBeVisible();
      // Both builds are cached side by side; the page keeps running the old one.
      expect(await page.evaluate(() => caches.keys())).toEqual(
        expect.arrayContaining([firstCache, nextCache]),
      );
      await page.waitForTimeout(2_000);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(loadedAt);

      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await page.waitForFunction((before) => performance.timeOrigin !== before, loadedAt, {
        timeout: 60_000,
      });
      await page.getByTestId('search-input').waitFor();
      await expect
        .poll(() => page.evaluate(() => caches.keys()), { timeout: 30_000 })
        .toEqual(expect.arrayContaining([nextCache]));
      expect(await page.evaluate(() => caches.keys())).not.toContain(firstCache);
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    } finally {
      await proxy.close();
    }
  });
});

test.describe('a lazy screen that cannot load', () => {
  // Without a worker, as on a first visit or in a browser that keeps none.
  test.use({ serviceWorkers: 'block' });

  async function openCalculators(page: Page): Promise<void> {
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: 'Калькуляторы', exact: true })
      .click();
  }

  test('a chunk removed by a deploy reloads the page once onto the current build', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    let removed = 0;
    await page.route('**/assets/CalculatorsView-*.js', (route) => {
      removed += 1;
      return removed === 1
        ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' })
        : route.continue();
    });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await mountBuiltApp(page);
    await openCalculators(page);

    await expect(page.getByTestId('calculator-section-anthropometry')).toBeVisible({
      timeout: 120_000,
    });
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(loads).toBe(2);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), CHUNK_RELOAD_KEY)).not.toBe(
      null,
    );
  });

  test('when the reload does not help it stops and says so in place', async ({ page }) => {
    test.setTimeout(240_000);
    await page.route('**/assets/CalculatorsView-*.js', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }),
    );
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await mountBuiltApp(page);
    await openCalculators(page);

    await expect(page.getByTestId('lazy-load-error')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.app-view__spinner')).toHaveCount(0);
    await page.waitForTimeout(3_000);
    expect(loads).toBe(2);
  });

  test('offline it shows the error in place and does not reload', async ({ context, page }) => {
    test.setTimeout(240_000);
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    // Once search is usable the app warms every tab's code in the background; the screen under test
    // must not slip in before the connection goes, so its code never arrives while online either.
    await page.route('**/assets/CalculatorsView-*.js', (route) =>
      route.abort('internetdisconnected'),
    );
    // The core finishes its download first: going offline mid-download would show the core error.
    await mountBuiltApp(page, { waitForCore: true });
    await context.setOffline(true);
    await openCalculators(page);

    await expect(page.getByTestId('lazy-load-error')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('lazy-load-error')).toContainText('Нет сети');
    await expect(page.locator('.app-view__spinner')).toHaveCount(0);
    await page.waitForTimeout(2_000);
    expect(loads).toBe(1);
  });
});
