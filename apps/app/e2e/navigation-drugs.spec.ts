import { expect, type Page, test } from '@playwright/test';
import { installMedicationModule, routeMedicationModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// NAV1 on the drug flows: the ATC sheet and the ATC tree return to the drug one press per layer
// (with the sheet closed), and the interaction checker keeps its drugs in the address.

const DRUG_ROUTE = `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from('esklp.mnn.албендазол').toString('base64url')}`;

const entries = (page: Page): Promise<number> => page.evaluate(() => window.history.length);

async function openDrugWithModule(page: Page): Promise<void> {
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);
  await expect(page.locator('.drug-link--code').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('ATC sheet and tree return to the drug', () => {
  test('‹ climbs one layer per press: tree level, tree group, then the drug with the sheet closed', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openDrugWithModule(page);
    const chip = page.locator('.drug-link--code').first();
    const code = ((await chip.textContent()) ?? '').trim().split(/\s/u)[0] ?? '';
    const atEntries = await entries(page);

    await chip.click();
    const levels = page.getByTestId('atc-level');
    await expect(levels).toHaveCount(5, { timeout: 30_000 });
    // The sheet is a layer: one entry.
    expect(await entries(page)).toBe(atEntries + 1);
    await levels.nth(2).click();
    const group = `${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/${code.slice(0, 4)}`;
    await expect(page).toHaveURL(group);
    await expect(page.locator('.atc-sheet__content')).toHaveCount(0);

    // A deeper level of the tree, if the group has one.
    const child = page.locator('.atc-tree__list .atc-row').first();
    let deeper = false;
    if ((await child.count()) > 0) {
      await child.click();
      await expect(page).not.toHaveURL(group);
      deeper = true;
    }
    const atTree = await entries(page);

    if (deeper) {
      await page.getByRole('button', { name: 'Назад' }).first().click();
      await expect(page).toHaveURL(group);
      expect(await entries(page)).toBe(atTree);
    }
    // ‹ from the group returns to the drug in one press (no phantom step), the sheet closed.
    await page.getByRole('button', { name: 'Назад' }).first().click();
    await expect(page).toHaveURL(DRUG_ROUTE);
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.atc-sheet__content')).toHaveCount(0);
    expect(await entries(page)).toBe(atTree);
  });

  test('the system back follows the same path as ‹', async ({ page }) => {
    test.setTimeout(240_000);
    await openDrugWithModule(page);
    const chip = page.locator('.drug-link--code').first();
    const code = ((await chip.textContent()) ?? '').trim().split(/\s/u)[0] ?? '';
    await chip.click();
    await expect(page.getByTestId('atc-level')).toHaveCount(5, { timeout: 30_000 });
    // Back closes the sheet and stays on the drug.
    await page.goBack();
    await expect(page.locator('.atc-sheet__content')).toHaveCount(0);
    await expect(page).toHaveURL(DRUG_ROUTE);
    await chip.click();
    await page.getByTestId('atc-level').nth(1).click();
    await expect(page).toHaveURL(
      `${E2E_ASSET_ORIGIN}/#/modules/documents/medications/atc/${code.slice(0, 3)}`,
    );
    // One back from the group: the drug, not the sheet again.
    await page.goBack();
    await expect(page).toHaveURL(DRUG_ROUTE);
    await expect(page.locator('.atc-sheet__content')).toHaveCount(0);
    await expect(chip).toBeVisible({ timeout: 30_000 });
  });
});

test('the interaction checker keeps its drugs in the address and its drug names open the drug', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const drug = 'албендазол';
  await openDrugWithModule(page);
  const slug = drug;
  // The tool opened with an exact card, as the link from a drug or a search result does.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?c=${encodeURIComponent(slug)}`);
  const item = page.getByTestId('interaction-item').first();
  await expect(item).toBeVisible({ timeout: 60_000 });
  // The address carries the chosen drug.
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain(`c=`);

  // Leave for another tab and come back through the tab bar: the drug is still chosen.
  const nav = page.locator('.app-bottom-nav');
  await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/u);
  await nav.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?c=${encodeURIComponent(slug)}`);
  await expect(page.getByTestId('interaction-item')).toHaveCount(1);

  // The name opens the drug screen; back returns to the checker with the drug chosen.
  await page.locator('.drug-interactions__item-link').first().click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  await page.goBack();
  await expect(page).toHaveURL(/#\/notes\/drug-interactions\?/u);
  await expect(page.getByTestId('interaction-item')).toHaveCount(1);
});

test('a comparison column title opens the drug; back returns to the comparison with its drugs', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openDrugWithModule(page);
  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/notes/drug-comparison?c=${encodeURIComponent('албендазол')}&c=${encodeURIComponent('празиквантел')}`,
  );
  const columns = page.getByTestId('comparison-column');
  await expect(columns).toHaveCount(2, { timeout: 60_000 });
  // The chosen drugs are in the address.
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('c=');

  await page.locator('.drug-comparison__colhead-link').first().click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  await page.goBack();
  await expect(page).toHaveURL(/#\/notes\/drug-comparison\?/u);
  await expect(page.getByTestId('comparison-column')).toHaveCount(2, { timeout: 30_000 });
});
