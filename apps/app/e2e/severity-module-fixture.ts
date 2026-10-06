import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';

/**
 * The optional DDInter severity module (INT2) installed from its locally built release bytes
 * (`data/build/ddinter-severity/zst`, kept as the local release copy; built by
 * `build_ddinter_severity_module.py` and `package-instruction-modules.ts --family ddinter`).
 * The committed catalog says `minAppVersion` 0.6.52; the test app may be older, so the catalog
 * chunk of the built app is served with this module's minimum lowered.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
export const SEVERITY_MODULE_ID = 'minimed.reference.ddinter-severity.ru';
const LOCAL_DIRECTORY = 'data/build/ddinter-severity/zst';
const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';

export async function routeSeverityModule(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(await readFile(resolve(ROOT, CATALOG_PATH), 'utf8')),
  );
  const artifact = catalog.modules.find((module) => module.id === SEVERITY_MODULE_ID)?.artifacts[0];
  if (!artifact?.url) throw new Error('The severity module is not in the catalog preview.');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(ROOT, LOCAL_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The severity module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);

  // The catalog is compiled into a chunk of the built app; lower this module's minimum there.
  const minimum = new RegExp(
    `("id":"${SEVERITY_MODULE_ID.replaceAll('.', '\\.')}".*?"minAppVersion":)"[^"]+"`,
    'su',
  );
  await page.route(/\/assets\/module-catalog-[^/]+\.js$/u, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    // Only the chunk that holds the catalog mentions the module.
    if (!body.includes(`"id":"${SEVERITY_MODULE_ID}"`)) return route.fulfill({ response, body });
    if (!minimum.test(body))
      throw new Error('The severity module has no minimum version to lower.');
    return route.fulfill({ response, body: body.replace(minimum, '$1"0.0.1"') });
  });
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (route) =>
      route.fulfill({
        body: bytes,
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      }),
  );
}
