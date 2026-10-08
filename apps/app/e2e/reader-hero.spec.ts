import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Worktrees (.claude/worktrees/<name>) keep the big local data in the main checkout.
const CHECKOUTS = [ROOT, resolve(ROOT, '../../..')];
const MODULE_FILE = 'minimed.reference.krasotaimedicina.2026.9.28.db.zst';
const ARTICLE = 'krasotaimedicina.disease.0007ef852d70ba32';
const POINTER = `core.catalog.pointer.reference.${ARTICLE}-82f435504305e1c9`;
const IMAGE_MIRROR =
  /^https:\/\/raw\.githubusercontent\.com\/T-Damer\/MiniMed\/datasets\/.*\/assets\//u;

const route = (id: string): string =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

function localFile(...segments: string[]): string | undefined {
  return CHECKOUTS.map((root) => resolve(root, ...segments)).find((path) => existsSync(path));
}

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('an illustrated article shows its picture as a hero behind the title, once, and opens it full screen', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const modulePath = localFile('data/build/krasotaimedicina-module/release', MODULE_FILE);
  const assets = localFile('apps/app/public/content/reference-images/assets');
  test.skip(!modulePath || !assets, 'The local reference module and its images are not present.');
  if (!modulePath || !assets) return;

  // The module is 100 MB: a route cannot carry it (a CDP message stops at 100 MiB), so it is
  // served over HTTP and the app's request is sent there.
  const server = createServer((_request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/zstd');
    createReadStream(modulePath).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const moduleUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/module.zst`;
  try {
    await page.route(
      (url) => url.pathname.endsWith(`/${MODULE_FILE}`),
      (request) => request.continue({ url: moduleUrl }),
    );
    // The images come from a mirror on a real device; here they are the local copies.
    await page.route(IMAGE_MIRROR, async (request) => {
      const file = resolve(assets, basename(new URL(request.request().url()).pathname));
      await request.fulfill({ body: await readFile(file), contentType: 'image/jpeg' });
    });
    await mountBuiltApp(page);

    // The short page (the pointer in the core) already has the picture behind its title.
    await page.goto(route(POINTER));
    const hero = page.locator('.reader-hero--image');
    await expect(hero).toBeVisible({ timeout: 90_000 });
    await expect(hero.locator('.reader-hero__photo')).toHaveJSProperty('complete', true);
    await expect(hero.locator('.document-overlay-paper__title')).toContainText('Депрессия');

    // The installed article keeps one hero: the same picture is not repeated inline.
    await page.locator('.document-module-pointer__action').click();
    await expect(page).toHaveURL(route(ARTICLE), { timeout: 200_000 });
    await expect(page.locator('.reader-hero--image')).toBeVisible();
    await expect(page.locator('.document-overlay-section__title').first()).toBeVisible();
    await expect(page.locator('.document-reference-image__image[alt="Депрессия"]')).toHaveCount(0);

    // A tap on the hero opens the picture full screen.
    await page.locator('.reader-hero__open').click();
    await expect(page.locator('.media-viewer__image')).toBeVisible();
    // The picture is fitted to the free area of the dark stage and centred in it.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const image = document.querySelector('.media-viewer__image')?.getBoundingClientRect();
          const area = document.querySelector('.media-viewer__content')?.getBoundingClientRect();
          if (!image || !area) return false;
          const fits =
            image.left >= area.left - 1 &&
            image.right <= area.right + 1 &&
            image.top >= area.top - 1 &&
            image.bottom <= area.bottom + 1;
          const centred = Math.abs(image.left + image.width / 2 - (area.left + area.width / 2)) < 2;
          return (
            fits && centred && (image.width > area.width * 0.9 || image.height > area.height * 0.6)
          );
        }),
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.media-viewer')).toHaveCount(0);
  } finally {
    server.close();
  }
});
