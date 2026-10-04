import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Local copy of the published zstd index (docs/data-ledger.json keeps it as the release copy).
const PUBLISHED_DIRECTORY = resolve(ROOT, 'output/module-zstd-2026-10-01/esklp-compacted');
const GROUP = process.env['UX4_GROUP'] ?? 'antiparasitic';
const GROUP_FILE = `minimed.medications.${GROUP}.ru.db.zst`;
const GROUP_CODES: Readonly<Record<string, string>> = {
  antiparasitic: 'P',
  'nervous-system': 'N',
  respiratory: 'R',
  'sensory-organs': 'S',
};
const GROUP_CODE = GROUP_CODES[GROUP] ?? 'P';
const SHOTS = process.env['UX4_SHOTS'];

// The ATC tree lists substances of installed ЕСКЛП packages and downloads a missing group through
// the same queue as the catalog's own button.
test('the ATC tree downloads a group, drills down to a substance and deep-links', async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !existsSync(resolve(PUBLISHED_DIRECTORY, GROUP_FILE)),
    'The module file is local-only.',
  );
  const bytes = await readFile(resolve(PUBLISHED_DIRECTORY, GROUP_FILE));
  await page.route(
    (url) => url.pathname.endsWith(`/${GROUP_FILE}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });

  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.getByRole('radio', { name: 'По группам АТХ' }).check({ force: true });
  await expect(page).toHaveURL(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc`);
  await expect(page.locator('.atc-group')).toHaveCount(14, { timeout: 60_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/level1-empty.png` });

  const installable = page.locator('.atc-group').filter({
    has: page.locator('.atc-row__code', { hasText: new RegExp(`^${GROUP_CODE}$`, 'u') }),
  });
  const action = installable.locator('.atc-group__action');
  await expect(action).toContainText('Скачать', { timeout: 60_000 });
  const code = GROUP_CODE;
  await action.click();
  await expect(installable.locator('button.atc-row')).toBeVisible({ timeout: 120_000 });
  await expect(installable.locator('.atc-row__meta')).toContainText('вещ');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/level1-installed.png` });

  await installable.locator('button.atc-row').click();
  await expect(page).toHaveURL(new RegExp(`/atc/${code}$`, 'u'));
  await expect(page.locator('.atc-tree__head-code')).toHaveText(code);
  // Down to the first substance list: the deepest child each time.
  for (let depth = 0; depth < 3; depth += 1) {
    if (SHOTS && depth === 1) await page.screenshot({ path: `${SHOTS}/level3.png` });
    const child = page.locator('.atc-tree__list button.atc-row').first();
    if ((await child.count()) === 0) break;
    await child.click();
  }
  await expect(page.locator('.atc-substance').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/substances.png` });

  // The address of a node opens it again after a reload, and back climbs one level.
  const openedUrl = page.url();
  await page.reload();
  expect(page.url()).toBe(openedUrl);
  await expect(page.locator('.atc-substance').first()).toBeVisible({ timeout: 60_000 });

  await page.locator('.atc-substance').first().click();
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 30_000 });
});
