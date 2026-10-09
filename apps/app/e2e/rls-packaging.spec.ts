import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchReady,
} from '@localmed/app/e2e/mount-built-app';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'default' });

const ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE = resolve(ROOT, 'playwright/rls-packaging-fixture');
const TARGET = 'rls.packaging.a6640f2df4c1cec3';
const documentRoute = (id: string, anchor?: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(anchor ? `${id}\n${anchor}` : id).toString('base64url')}`;

test.beforeAll(() => {
  execFileSync(
    'uv',
    [
      'run',
      '--project',
      'tools/ingest',
      'python',
      '-c',
      'from pathlib import Path; import runpy; runpy.run_path("tools/ingest/tests/test_rls_mkb_modules.py")["_split_and_build"](Path("playwright/rls-packaging-fixture"))',
    ],
    {
      cwd: ROOT,
      env: {
        HOME: '/Users/d',
        PATH: '/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
        TMPDIR: '/tmp',
        LANG: 'en_US.UTF-8',
      },
      stdio: 'pipe',
    },
  );
});
test.afterAll(async () => {
  await rm(FIXTURE, { recursive: true, force: true });
});

for (const experimental of [false, true]) {
  test(`a source-listed medication opens the exact packaging download route (experiments ${experimental})`, async ({
    page,
  }) => {
    await page.route(`${E2E_ASSET_ORIGIN}/content/reference.db`, async (route) =>
      route.fulfill({
        body: await readFile(resolve(FIXTURE, 'code.db')),
        contentType: 'application/octet-stream',
      }),
    );
    await mountBuiltApp(page, {
      localStorage: {
        'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: experimental }),
      },
    });
    await page.goto(documentRoute('rls.mkb.node.i67-9'));
    await page.getByRole('button', { name: 'Упаковки препаратов на странице РЛС' }).click();
    await page.getByRole('link', { name: 'Абактал® — формы и упаковки' }).click();
    await expect(page).toHaveURL(documentRoute(TARGET));
    await expect(page.locator('.document-module-pointer__title')).toHaveText(
      experimental ? /^Полная версия — в наборе/u : 'Полный документ пока недоступен',
    );
    await expect(page.locator('.document-module-pointer__action')).toHaveCount(
      experimental ? 1 : 0,
    );
  });
}

test('an installed registry entry does not make an absent packaging document readable', async ({
  page,
}) => {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const module = catalog.modules.find((entry) => entry.id === 'minimed.rls.packaging.ru');
  if (!module) throw new Error('Missing packaging module');
  const now = '2026-09-30T00:00:00Z';
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'localmed.installed-modules.v1': JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            moduleId: module.id,
            required: false,
            enabled: true,
            updateAvailable: false,
            history: [],
            active: {
              moduleId: module.id,
              version: module.version,
              required: false,
              installedAt: now,
              installedSizeBytes: module.sizes.installedBytes,
              sourceSetDigest: module.sourceSetDigest,
              validation: {
                checkedAt: now,
                valid: true,
                checksumValid: true,
                schemaCompatible: true,
                sqliteIntegrity: 'ok',
                message: 'Fixture registry with missing artifact',
              },
            },
          },
        ],
      }),
    },
  });
  // A cold profile first copies the whole core into OPFS; the pointer page waits for it.
  await waitForSearchReady(page);
  await page.goto(documentRoute(TARGET));
  await expect(page.locator('.document-module-pointer__error')).toContainText(
    'Набор установлен, но полный документ недоступен',
  );
  await expect(page.locator('.document-module-pointer__action')).toHaveCount(0);
  await expect(page.locator('.document-text-chunk')).toHaveCount(0);
});

test('installs a verified packaging target and reads it offline after reloading with its source anchor', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const module = catalog.modules.find((entry) => entry.id === 'minimed.rls.packaging.ru');
  const artifact = module?.artifacts.find((entry) => entry.kind === 'index');
  const member = module?.documents.find((entry) => entry.documentId === TARGET);
  if (!artifact?.url || !member) throw new Error('Missing exact RLS packaging catalog member');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(ROOT, 'data/build/rls-mkb-module/release', fileName);
  test.skip(!existsSync(localPath), 'RLS packaging release file is local-only.');
  const databasePath = resolve(ROOT, 'data/build/rls-mkb-module/minimed.rls.packaging.db');
  test.skip(!existsSync(databasePath), 'Decoded RLS packaging fixture is local-only.');
  const sourceAnchor = execFileSync(
    'sqlite3',
    [
      databasePath,
      `SELECT c.anchor FROM chunks c JOIN documents d ON d.current_version_id=c.document_version_id WHERE d.id='${TARGET}' ORDER BY c.order_index DESC LIMIT 1`,
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!sourceAnchor) throw new Error('Missing source packaging anchor');
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (route) => route.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(documentRoute(TARGET, sourceAnchor));
  await page.locator('.document-module-pointer__action').click();
  await expect(page.locator(`[id="${sourceAnchor}"]`)).toBeInViewport({ timeout: 180_000 });
  await expect(page.locator('.document-module-pointer')).toHaveCount(0);
  const anchor = sourceAnchor;
  await page.goto(documentRoute(TARGET, anchor));
  await expect(page.locator(`[id="${anchor}"]`)).toBeInViewport();
  await page.reload();
  await expect(page.locator(`[id="${anchor}"]`)).toBeInViewport({ timeout: 60_000 });
  await page.context().setOffline(true);
  await page.goto(documentRoute(TARGET));
  await page.goto(documentRoute(TARGET, anchor));
  await expect(page.locator(`[id="${anchor}"]`)).toBeInViewport({ timeout: 60_000 });
  await expect(page.locator('.document-module-pointer__action')).toHaveCount(0);
});
