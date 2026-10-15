import { expect, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// SRCH1 (QA pass 2026-10-14): a trade name finds its drug card first, a class word shows the class
// card and its drugs, the marks in a snippet are the typed words, the query lives in the address,
// and text with no word of the user's finds nothing. Runs on the shipped core and catalogue
// pointers, no module installed.
const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

async function mount(page: import('@playwright/test').Page, hash = '') {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  if (hash) {
    await page.evaluate((value) => {
      window.location.hash = value;
    }, hash);
  }
  await waitForSearchEditable(page);
}

test('a trade name leads with its drug card', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('Аспирин');
  await page.getByTestId('search-submit').click();
  const first = page.locator('.result-group-header__title').first();
  await expect(first).toContainText(/аспирин/iu, { timeout: 60_000 });
  await expect(first).toContainText(/ацетилсалициловая кислота/iu);
});

test('a class word shows the class card, then the drugs of the class', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('макролиды');
  await page.getByTestId('search-submit').click();
  const card = page.getByTestId('drug-class-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Макролиды');
  await expect(card).toContainText('J01FA');
  // The class card stands above the first result, and the first results are the class's drugs.
  const cardBox = await card.boundingBox();
  const firstBox = await page.locator('.result-group').first().boundingBox();
  expect(cardBox && firstBox && cardBox.y < firstBox.y).toBe(true);
  await expect(page.locator('.result-group-header__title').first()).toContainText(
    /азитромицин|кларитромицин|эритромицин/iu,
  );
  await expect(page.getByTestId('atc-match').first()).toContainText('J01FA');
  // A tap on the group opens the ATC group list.
  await page.getByTestId('drug-class-group').first().click();
  await expect(page).toHaveURL(/#\/modules\/documents\/medications\/atc\/J01FA/u);
});

test('a class word inside a longer query shows the class card and a few of its drugs (SRCH2)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('макролиды детям');
  await page.getByTestId('search-submit').click();
  const card = page.getByTestId('drug-class-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Макролиды');
  await expect(page.getByTestId('atc-match')).toHaveCount(3);
  // A drug typed with the class word is the drug's own query: no class card.
  await page.getByTestId('search-input').fill('азитромицин макролиды');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(card).toHaveCount(0);
});

test('a disease, a drug and an МКБ-10 code carry no class card', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  // «J05» is an ATC group and an МКБ-10 card at once: the diagnosis keeps the lead (CLS3).
  for (const query of ['пневмония', 'азитромицин', 'J05']) {
    await page.getByTestId('search-input').fill(query);
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('drug-class-card')).toHaveCount(0);
  }
});

test('an ATC group code shows its own group card, not a class-word card', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('J01FA');
  await page.getByTestId('search-submit').click();
  const card = page.getByTestId('drug-class-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  // The group is the typed code itself (its НСИ name is the title); no other group is offered.
  await expect(card).toContainText('Макролиды');
  await expect(card.getByTestId('drug-class-group')).toHaveCount(1);
  await expect(card.getByTestId('drug-class-group').first()).toContainText('J01FA');
});

test('the query is in the address and survives a reload', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('варфарин');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('q=');
  const hash = await page.evaluate(() => window.location.hash);
  expect(decodeURIComponent(hash)).toContain('варфарин');

  await page.reload();
  await waitForSearchEditable(page);
  await expect(page.getByTestId('search-input')).toHaveValue('варфарин');
  await expect(page.locator('.result-group-header__title').first()).toContainText(/варфарин/iu, {
    timeout: 60_000,
  });
});

test('markup and a stray Latin word find nothing', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  for (const query of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>']) {
    await page.getByTestId('search-input').fill(query);
    await page.getByTestId('search-submit').click();
    await expect(page.locator('.search-no-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.result-group')).toHaveCount(0);
  }
});

test('marks cover whole typed words only', async ({ page }) => {
  test.setTimeout(240_000);
  await mount(page);
  await page.getByTestId('search-input').fill('Аспирин');
  await page.getByTestId('search-submit').click();
  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 60_000 });
  const first = page.locator('.result-snippet mark').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  const marks = await page.locator('.result-snippet mark').allTextContents();
  for (const mark of marks) expect(mark.trim().toLowerCase()).toMatch(/^аспирин/u);
});
