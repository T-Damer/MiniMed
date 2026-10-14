import { expect, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// DRUG-UI1: a drug whose module is not installed still shows its ATC code, read from the
// comparison index that ships with the app; a two-code drug opens a sheet with both ladders and the
// tapped code's ladder highlighted. No module is installed.
const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

test('the code of a drug without its module shows from the index and the sheet follows the tapped code', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);
  await input.fill('J05AX13');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('atc-match').first()).toContainText('J05AX13', {
    timeout: 60_000,
  });
  await page.locator('.result-group-header__title').first().click();

  const atc = page.getByTestId('drug-index-atc');
  await expect(atc).toBeVisible({ timeout: 60_000 });
  // One control: the agreed code with the registry's stub beside it, not a second chip.
  await expect(atc.locator('.drug-code')).toHaveCount(1);
  await expect(atc.locator('.drug-chip--code')).toHaveText('J05AX13');
  await expect(atc.locator('.drug-code__registry')).toContainText('L03AX');

  // The registry part opens the sheet on its own ladder.
  await atc.locator('.drug-code__registry').click();
  await expect(page.getByTestId('atc-ladder-main')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('atc-ladder-registry')).toHaveAttribute('data-focus', 'true');
  await expect(page.getByTestId('atc-ladder-main')).not.toHaveAttribute('data-focus', 'true');
  await expect(page.getByRole('dialog')).toContainText('Код АТХ L03AX');
  await page.keyboard.press('Escape');

  // The main part highlights the main ladder.
  await atc.locator('.drug-chip--code').click();
  await expect(page.getByTestId('atc-ladder-main')).toHaveAttribute('data-focus', 'true');
  await expect(page.getByRole('dialog')).toContainText('Код АТХ J05AX13');
});
