import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  MEDICATION_MODULE_ID,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchReady } from './mount-built-app';

/**
 * The «?» over a packaging photo opens the photo's source. The photos come from the published pack
 * (the local release copy of `datasets/allmed-images-…`) and the drug from the Allmed module, both
 * served from local copies; the spec skips when a copy is absent.
 */
const CHECKOUT = resolve(import.meta.dirname, '../../..');
// An agent worktree lives under `<main checkout>/.claude/worktrees/`; the release copies stay in the main one.
const LOCAL_DATA_ROOT = existsSync(resolve(CHECKOUT, 'output'))
  ? CHECKOUT
  : resolve(CHECKOUT, '../../..');
const IMAGES_DIRECTORY = resolve(LOCAL_DATA_ROOT, 'output/allmed-images-2026.10.13-c8e85a688094');
const ALLMED_FILE = resolve(
  LOCAL_DATA_ROOT,
  'output/module-zstd-drug-kd1-2026-10-11/allmed-2026.10.05-2d39a7fc2b43-kd1/minimed.medications.ru.db.zst',
);

test.use({ launchOptions: { args: ['--mute-audio'] } });

async function routeLocalFiles(page: Page): Promise<void> {
  test.skip(
    !existsSync(IMAGES_DIRECTORY) || !existsSync(ALLMED_FILE),
    'The Allmed module and photo pack release copies are local-only.',
  );
  await page.route(
    (url) => /minimed\.medications\.packaging-images\.ru\./u.test(url.pathname),
    async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
      await route.fulfill({
        body: await readFile(resolve(IMAGES_DIRECTORY, name)),
        headers: { 'access-control-allow-origin': '*' },
      });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith('/minimed.medications.ru.db.zst'),
    async (route) =>
      route.fulfill({
        body: await readFile(ALLMED_FILE),
        contentType: 'application/zstd',
        headers: { 'access-control-allow-origin': '*' },
      }),
  );
}

test('the «?» over a packaging photo opens its source', async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const SHOTS = testInfo.outputDir;
  // Only the files served below may leave the machine: every other module download fails at once.
  await page.route(/raw\.githubusercontent\.com|github\.com\/T-Damer/u, (route) => route.abort());
  await routeMedicationModule(page);
  await routeLocalFiles(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings/images`);
  const card = page.getByTestId('packaging-images-settings');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Скачать фотографии' }).click();
  await expect(card.getByRole('button', { name: 'Удалить' })).toBeVisible({ timeout: 120_000 });

  await waitForSearchReady(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.getByRole('button', { name: /Скачать препараты/u }).click({ timeout: 60_000 });
  await expect(page.locator('.medication-product-card').first()).toBeVisible({ timeout: 280_000 });
  await page.getByRole('searchbox').first().fill('Немозол');
  const product = page.locator('.medication-product-card', { hasText: 'Немозол' }).first();
  await product.click({ timeout: 60_000 });

  const header = page.locator('.drug-header');
  await expect(header).toHaveClass(/drug-header--with-image/u, { timeout: 60_000 });
  await expect(page.locator('.drug-header__credit')).toHaveCount(0);
  const button = header.getByRole('button', { name: 'Источник изображения' });
  await expect(button).toBeVisible();

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/pk-drug-${colorScheme}.png` });
    await button.click();
    const panel = page.getByRole('dialog', { name: 'Источник изображения' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Allmed');
    await expect(panel.getByRole('link')).toHaveAttribute(
      'href',
      /^https:\/\/allmed\.pro\/img\/preparations\/\d+\.(?:jpe?g|png)$/u,
    );
    await expect(panel).toContainText(/Получено \d{1,2} \S+ 20\d\d г\./u);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/pk-source-${colorScheme}.png` });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }

  // On a wide screen the same content opens as a popover beside the button.
  await page.setViewportSize({ width: 1100, height: 800 });
  await button.click();
  const popover = page.getByRole('dialog', { name: 'Источник изображения' });
  await expect(popover).toContainText('Allmed');
  await page.screenshot({ path: `${SHOTS}/pk-source-wide.png` });
});
