import { expect, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// ATC5: a drug is found by its ATC code in the main search and in the drug pickers. The drugs come
// from the shipped catalogue pointers and the comparison index, so no module has to be installed.
// Screenshots: ATC5_SHOTS=<directory>.
const SHOTS = process.env['ATC5_SHOTS'];

const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

test('the main search lists the drugs of a typed ATC code with the code that matched', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);

  // A code the registry holds only as a group stub: the agreed code first, the stub beside it.
  await input.fill('J05AX13');
  await page.getByTestId('search-submit').click();
  const match = page.getByTestId('atc-match').first();
  await expect(match).toContainText('J05AX13', { timeout: 60_000 });
  await expect(match).toContainText('в реестре: L03AX');
  await expect(page.locator('.result-group-header__title').first()).toContainText(/умифеновир/iu);
  if (SHOTS) {
    // Let the results settle in over the loading skeleton before the picture.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/main-search-code.png` });
  }

  // A group prefix lists several drugs, each under its own code.
  await input.fill('j05ab');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('atc-match').nth(1)).toBeVisible({ timeout: 60_000 });
  const codes = await page.getByTestId('atc-match').allTextContents();
  expect(codes.length).toBeGreaterThan(1);
  for (const code of codes) expect(code).toMatch(/^J05AB/u);

  // The same code typed with the Russian layout on says what it was read as.
  await input.fill('о05ах13');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('atc-match').first()).toContainText('J05AX13', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('search-rewrite-note')).toContainText('J05AX13');

  // An ordinary word or a lone letter with a digit is no code.
  await input.fill('ВИЧ');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('atc-match')).toHaveCount(0);
});

test('the drug comparison picker suggests drugs by ATC code', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  await waitForSearchEditable(page);
  await page.evaluate(() => {
    window.location.hash = '#/notes/drug-comparison';
  });
  const field = page.getByPlaceholder('Препарат, МНН или код АТХ');
  await field.fill('J05AX13');
  const candidate = page.locator('.drug-comparison__candidate').first();
  await expect(candidate).toContainText(/умифеновир/iu, { timeout: 90_000 });
  await expect(candidate.getByTestId('atc-match')).toContainText('J05AX13');
  await expect(candidate.getByTestId('atc-match')).toContainText('в реестре: L03AX');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comparison-picker-code.png` });

  await candidate.click();
  await expect(page.getByTestId('comparison-item')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('comparison-item')).toContainText(/умифеновир/iu);
});
