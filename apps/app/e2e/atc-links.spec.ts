import { expect, test } from '@playwright/test';
import { installMedicationModule, routeMedicationModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// ATC5: a code is a link that explains itself. On the drug screen the ATC chip opens the code
// level by level; each level leads to the drugs of its group (the ATC tree for a group, the medication
// list for a full code). Installs the smallest ЕСКЛП group from its published bytes (a local release
// copy, see docs/data-ledger.json); skipped when absent. Screenshots: ATC5_SHOTS=<directory>.
const SHOTS = process.env['ATC5_SHOTS'];

test('the ATC chip opens the code level by level and each level opens its group', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);

  const chip = page.locator('.drug-link--code').first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  const code = ((await chip.textContent()) ?? '').trim().split(/\s/u)[0] ?? '';
  expect(code).toMatch(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/u);

  // The sheet: one row per level, each a link, the code's own names from the NSI dictionary.
  await chip.click();
  const levels = page.getByTestId('atc-level');
  await expect(levels).toHaveCount(5, { timeout: 30_000 });
  await expect(levels.nth(0)).toHaveAttribute('data-code', code.slice(0, 1));
  await expect(levels.nth(1)).toHaveAttribute('data-code', code.slice(0, 3));
  await expect(levels.nth(4)).toHaveAttribute('data-code', code);
  await expect(levels.nth(1)).toContainText(/[а-яё]{4,}/iu);
  if (SHOTS) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/code-sheet.png` });
  }

  // A group level opens the ATC tree at that node.
  await levels.nth(1).click();
  await expect(page).toHaveURL(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/${code.slice(0, 3)}`,
  );
  await expect(page.locator('.atc-tree__head-code')).toHaveText(code.slice(0, 3));
  await expect(page.locator('.atc-sheet__content')).toHaveCount(0);

  // The full code opens the medication list filtered by it.
  await page.goBack();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  await expect(levels).toHaveCount(5);
  await levels.nth(4).click();
  await expect(page).toHaveURL(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await expect(page.getByRole('searchbox', { name: 'Поиск по препаратам' })).toHaveValue(code);
  await expect(page.locator('.medication-product-card').first()).toBeVisible({ timeout: 60_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/code-list.png` });
});

test('an ATC code in the text of a card is a link to the same sheet', async ({ page }) => {
  test.setTimeout(240_000);
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);

  const link = page.getByTestId('atc-inline-link').first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  const code = ((await link.textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/u);
  await link.click();
  const levels = page.getByTestId('atc-level');
  await expect(levels).toHaveCount(5, { timeout: 30_000 });
  // A code met in a text has no drug card behind it: its last level is named by the substances.
  await expect(levels.nth(4)).toContainText(/[а-яё]{4,}/iu);
  await levels.nth(0).click();
  await expect(page).toHaveURL(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/${code.slice(0, 1)}`,
  );
});
