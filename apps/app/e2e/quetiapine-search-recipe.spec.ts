import { expect, type Page, test } from '@playwright/test';
import { installMedicationGroup, routeMedicationGroup } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// SRCHDRUG1 (owner 2026-11-13, «Кветиапин»): the nervous-system ЕСКЛП group and its ГРЛС
// instructions (local release copies, docs/data-ledger.json; skipped when absent) are installed
// through the substance's core pointer, as a doctor would. Then:
//  1. the search shows each drug once — no separate «По названию» strip over the results;
//  2. the drug card's «Рецепт» opens the prescription for the drug on screen, never «нет карточки»;
//  3. «Выбрать» in the comparison opens a list picker (search, selected state, the drug's group).
// Screenshots: SRCHDRUG_SHOTS=<directory> (390 and 1280 wide, light and dark).
const SHOTS = process.env['SRCHDRUG_SHOTS'];
const POINTER = 'core.catalog.pointer.medication.esklp.mnn.кветиапин-4a6836f336013c7e';
const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const width = page.viewportSize()?.width ?? 0;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

for (const width of [390, 1280]) {
  test(`«Кветиапин»: one result per drug, a working recipe, a list picker (${width} px)`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await routeMedicationGroup(page, 'nervous-system');
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
    await installMedicationGroup(page, POINTER, 'esklp.mnn.кветиапин');

    // 1. Search: the results, and no title strip repeating them.
    await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
    await waitForSearchEditable(page);
    const input = page.getByTestId('search-input');
    await input.fill('Кветиапин');
    await page.getByTestId('search-submit').click();
    await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.result-group').first()).toContainText(/кветиапин/iu);
    await page.waitForTimeout(500);
    await shoot(page, '1-search');
    await expect.soft(page.locator('.search-meanings--titles')).toHaveCount(0);
    // Every title match of a drug name is a result already: nothing follows the list.
    await expect.soft(page.locator('.search-title-extras')).toHaveCount(0);

    // 2. The card's «Рецепт».
    await page.goto(
      `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from('esklp.mnn.кветиапин').toString('base64url')}`,
    );
    const menu = page.getByRole('button', { name: 'Меню действий' });
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await shoot(page, '2-card');
    await menu.click();
    await page.getByTestId('drug-recipe-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('Загружаем указатель', { timeout: 30_000 });
    await page.waitForTimeout(800);
    await shoot(page, '3-recipe');
    await expect.soft(dialog).not.toContainText('нет карточки');
    await expect.soft(dialog.getByTestId('prescription-item')).toContainText(/кветиапин/iu);
    // The form and the strength from the registry make the Rp. line.
    const item = dialog.getByTestId('prescription-item');
    if ((await item.count()) > 0) {
      await item
        .getByRole('group', { name: 'Лекарственная форма' })
        .getByRole('button')
        .first()
        .click();
      const strengths = item.getByRole('group', { name: 'Дозировка' }).getByRole('button');
      if ((await strengths.count()) > 0) await strengths.first().click();
      await expect(dialog.getByTestId('recipe-text')).toContainText('Rp.');
      await page.waitForTimeout(300);
      await shoot(page, '3b-recipe-filled');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // 2b. A drug with no dose instruction in the sources (пипофезин, ЖНВЛП): the Rp. line comes from
    // the registry and the doctor writes the sign, instead of «рецепт собрать не из чего».
    await page.goto(
      `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from('esklp.mnn.пипофезин').toString('base64url')}`,
    );
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await menu.click();
    await page.getByTestId('drug-recipe-button').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('Загружаем указатель', { timeout: 30_000 });
    await expect.soft(dialog).not.toContainText('не из чего');
    const sign = dialog.getByLabel('Способ применения');
    await expect.soft(sign).toBeVisible();
    if ((await sign.count()) > 0) {
      await sign.fill('По 1 таблетке 2 раза в день');
      await expect(dialog.getByTestId('recipe-text')).toContainText(
        'D.S. По 1 таблетке 2 раза в день',
      );
      await expect(dialog.getByTestId('recipe-text')).toContainText(/Rp\.: .*Pipofezin/u);
    }
    await page.waitForTimeout(300);
    await shoot(page, '3c-recipe-by-hand');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.goto(
      `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from('esklp.mnn.кветиапин').toString('base64url')}`,
    );
    await expect(menu).toBeVisible({ timeout: 60_000 });

    // 3. The comparison's «Выбрать».
    await menu.click();
    await page.getByTestId('drug-compare-link').click();
    await expect(page.getByTestId('comparison-item')).toHaveCount(1, { timeout: 60_000 });
    await shoot(page, '4-compare');
    const choose = page.getByTestId('comparison-choose');
    await expect.soft(choose).toBeVisible();
    if ((await choose.count()) === 0) return;
    await choose.click();
    const picker = page.getByTestId('comparison-picker');
    await expect(picker).toBeVisible();
    // Before typing: the drugs of the same ATC group, each with its group line.
    await expect(picker.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
    await expect(picker.locator('.list-row__subtitle').first()).not.toBeEmpty();
    await shoot(page, '5-picker');
    await picker.getByRole('searchbox').fill('оланзапин');
    const olanzapine = picker.locator('.list-row', { hasText: /оланзапин/iu }).first();
    await expect(olanzapine).toBeVisible({ timeout: 30_000 });
    await shoot(page, '6-picker-search');
    await olanzapine.locator('button').first().click();
    await expect(page.getByTestId('comparison-item')).toHaveCount(2, { timeout: 30_000 });
  });
}
