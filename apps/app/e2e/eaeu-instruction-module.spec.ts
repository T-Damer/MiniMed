import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * EA1: a Russian registration without a ГРЛС file opens the leaflet/ОХЛП of the same EAEU dossier
 * from the register of Kazakhstan or Belarus, with the country on the page and the register as the
 * source (owner 2026-10-26).
 *
 * The ЕСКЛП group «Органы чувств» and its ГРЛС instructions come from the public dataset mirror (the
 * catalog's own URLs); installing the group brings the EAEU module along. That module comes from the
 * local release copy (the main checkout's `output/` when this is a worktree), or from the mirror with
 * EAEU_E2E_MIRROR=1. The build must be at least the module's `minAppVersion` (0.6.66; before that
 * release, build with release.json bumped locally). Needs the network, so it runs on purpose:
 *
 *   EA1_E2E=1 E2E_PORT=4232 bunx playwright test eaeu-instruction-module --workers=1
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const CHECKOUTS = [ROOT, resolve(ROOT, '../../..')];
const MODULE_ID = 'minimed.medications.instructions.eaeu-sister-register.ru';
const RUN = process.env['EA1_E2E'] === '1';
const FROM_MIRROR = process.env['EAEU_E2E_MIRROR'] === '1';
const SHOTS = process.env['EA1_SHOTS'];
const CATALOG_PATH = resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json');
const RELEASE_DIRECTORY = 'output/module-zstd-eaeu-2026-10-26';

const catalog = ContentModuleCatalogSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')));
const artifact = catalog.modules
  .find((module) => module.id === MODULE_ID)
  ?.artifacts.find((entry) => entry.kind === 'index');
const FILE_NAME = new URL(artifact?.url ?? 'https://example.test/none').pathname
  .split('/')
  .at(-1) as string;

function localReleaseCopy(): string | undefined {
  for (const root of CHECKOUTS) {
    const path = resolve(root, RELEASE_DIRECTORY, FILE_NAME);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The trade name's own screen, through its «Открыть: …» button (folded lists are expanded). */
async function openTradeName(page: Page, name: string): Promise<void> {
  const target = page.getByRole('button', { name: new RegExp(`^Открыть: ${name}( \\(|$)`, 'u') });
  const more = page.getByRole('button', { name: /^Показать ещё/u });
  await expect(async () => {
    if (!(await target.first().isVisible()) && (await more.first().isVisible())) {
      await more.first().click();
    }
    // Inline names wrap: the centre of a wrapped button can fall on its neighbour, its start cannot.
    await target.first().click({ position: { x: 4, y: 4 }, timeout: 2_000 });
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 90_000 });
}

test('a registration without a ГРЛС file opens the Kazakh or Belarus text with the country named', async ({
  page,
}) => {
  test.skip(!RUN, 'Downloads drug modules from the dataset mirror; set EA1_E2E=1.');
  test.setTimeout(900_000);
  const file = FROM_MIRROR ? undefined : localReleaseCopy();
  test.skip(
    !FROM_MIRROR && !file,
    `The release copy ${RELEASE_DIRECTORY}/${FILE_NAME} is local-only and not in this checkout.`,
  );
  if (!FROM_MIRROR && file) {
    const bytes = readFileSync(file);
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact?.sha256);
    await page.route(
      (url) => url.pathname.endsWith(`/${FILE_NAME}`),
      (request) =>
        request.fulfill({
          body: bytes,
          contentType: 'application/zstd',
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  // The ATC tree downloads the ЕСКЛП group; its ГРЛС instructions and the EAEU texts come along.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/S`);
  await page.locator('.atc-group__action').click();
  await expect(page.locator('.atc-tree__head-code')).toHaveText('S', { timeout: 300_000 });

  // The tree has ATC levels 1–4; brimonidine + timolol (S01ED51) is a substance of S01ED.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/S01ED`);
  const substance = page
    .locator('.atc-substance')
    .filter({ hasText: /бримонидин/iu })
    .first();
  await expect(substance).toBeVisible({ timeout: 120_000 });
  await expect(async () => {
    await substance.click({ force: true, timeout: 2_000 });
    await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 90_000 });

  for (const [tradeName, country, host] of [
    ['Бримтим', 'Республика Казахстан', 'register.ndda.kz'],
    ['Брипрессия Плюс', 'Республика Беларусь', 'www.rceth.by'],
  ] as const) {
    await openTradeName(page, tradeName);
    // The group download brought the EAEU module along: no offer, the text itself, the country above it.
    await expect(page.locator('.document-medication-product__offer-button')).toHaveCount(0);
    await expect(page.locator('.document-instruction-source__match')).toContainText(
      `Текст из реестра лекарственных средств: ${country}`,
      { timeout: 300_000 },
    );
    await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${host}-card.png` });
    await expect(page.locator('.document-instruction-fallback')).toHaveCount(0);
    // Kind, register and link are under «⋯» → «Информация».
    await page.getByRole('button', { name: 'Меню действий' }).click();
    await page.getByTestId('document-info').click();
    const source = page.locator('.document-info .drug-reference');
    await expect(source).toContainText(`Реестр ЛС: ${country}`);
    await expect(source).toContainText(/Листок-вкладыш|ОХЛП/u);
    await expect(source).not.toContainText('ГРЛС (Минздрав России)');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${host}-info.png` });
    await expect(source.locator('.drug-reference__link')).toHaveAttribute(
      'href',
      new RegExp(`^https://${host.replaceAll('.', '\\.')}/`, 'u'),
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.document-info')).toHaveCount(0);
  }
});
