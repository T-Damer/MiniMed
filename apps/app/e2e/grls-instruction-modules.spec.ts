import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// Installs the ЕСКЛП group «Противопаразитарные» and then, from a drug screen, the group's official
// instructions — both from the public dataset mirror (the catalog's own URLs), so it needs the
// network and a build whose version is at least the modules' minAppVersion (E2E_ORIGIN points the
// suite at another preview server).
// Run it on purpose: GI1_MIRROR_E2E=1 bunx playwright test grls-instruction-modules
const MIRROR = process.env['GI1_MIRROR_E2E'] === '1';
const SHOTS = process.env['GI1_SHOTS'];

test('a drug without an official text offers the group instructions, then shows kind, edition and source', async ({
  page,
}) => {
  test.skip(!MIRROR, 'Downloads modules from the dataset mirror; set GI1_MIRROR_E2E=1.');
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });

  // The ATC tree downloads a missing ЕСКЛП group through the catalog's own queue.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc`);
  const group = page.locator('.atc-group').filter({
    has: page.locator('.atc-row__code', { hasText: /^P$/u }),
  });
  await group.locator('.atc-group__action').click();
  await expect(group.locator('button.atc-row')).toBeVisible({ timeout: 180_000 });

  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/P01BC`);
  const substance = page.locator('.atc-substance').first();
  await expect(substance).toBeVisible({ timeout: 120_000 });
  // The list re-renders while the catalog streams in: click until the substance card opens.
  await expect(async () => {
    await substance.click({ force: true, timeout: 2_000 });
    await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 90_000 });

  const chip = page.locator('button.drug-chip').filter({ hasText: 'Мефлохин' }).first();
  await expect(async () => {
    await chip.click({ force: true, timeout: 2_000 });
    await expect(page.getByRole('radio', { name: 'Инструкция' })).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 90_000 });

  // No instruction module is installed: the switch is disabled and the group is offered.
  const offer = page.locator('.document-medication-product__offer-button');
  await expect(offer).toContainText('Скачать инструкции группы', { timeout: 60_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/offer.png` });
  await offer.click({ force: true });

  const source = page.locator('.document-instruction-source');
  await expect(source).toBeVisible({ timeout: 240_000 });
  await expect(source).toContainText('Редакция');
  await expect(source).toContainText('ГРЛС');
  await expect(source.locator('.document-instruction-source__kind')).toHaveText(
    /Инструкция по медицинскому применению|Листок-вкладыш|ОХЛП/u,
  );
  await expect(source.locator('.document-instruction-source__link')).toHaveAttribute(
    'href',
    /^https:\/\/grls\.rosminzdrav\.ru\//u,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/instruction.png` });
});
