import { expect, type Page, test } from '@playwright/test';
import { routeInstructionModule } from './medication-module-fixture';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// SAFE1: «X при беременности», «X при ГВ», «X ребёнку 3 лет». The antiparasitic ГРЛС instruction
// module (a local release copy, see docs/data-ledger.json) holds the instruction of albendazole;
// the test installs it through the card's own download offer. Skipped when the copy is absent.
// Screenshots: SAFE1_SHOTS=<directory>.
const SHOTS = process.env['SAFE1_SHOTS'];

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function search(page: Page, query: string): Promise<void> {
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);
  await input.fill(query);
  await page.getByTestId('search-submit').click();
}

test('a pregnancy question shows the instruction sentences, never an answer of its own', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });

  await search(page, 'албендазол при беременности');
  const card = page.getByTestId('safety-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.safety-card__title')).toContainText('Албендазол');
  await expect(page.getByTestId('search-results')).toBeVisible();
  await expect(page.getByTestId('safety-notice')).toContainText('не отвечает «можно» или «нельзя»');

  // The index knows where the instruction speaks of it; the instruction is not installed yet.
  await expect(page.getByTestId('safety-not-installed')).toBeVisible({ timeout: 60_000 });
  const offer = page.locator('.safety-card__offer-button');
  await expect(offer).toContainText('Скачать инструкции группы', { timeout: 60_000 });
  await shoot(page, 'not-installed');
  await offer.click({ force: true });

  // After the download the sentences are quoted from the installed instruction, with their source.
  const quote = page.getByTestId('safety-quote').first();
  await expect(quote).toBeVisible({ timeout: 180_000 });
  await expect(quote).toContainText(/беременн/iu);
  await expect(quote.locator('.safety-card__mark').first()).toContainText(/беременн/iu);
  await expect(page.getByTestId('safety-source')).toContainText('ГРЛС');
  await expect(page.getByTestId('safety-source')).toContainText('Албендазол');
  await expect(card).toContainText('Это инструкция одного из препаратов с этим веществом');
  await shoot(page, 'pregnancy');

  // The quote opens the instruction at its place.
  await quote.locator('.safety-card__link').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  // The open instruction carries the same sentences in a folded block of its own.
  const block = page.getByTestId('drug-safety-block');
  await expect(block).toBeVisible({ timeout: 60_000 });
  await block.getByRole('button', { name: /Беременность, ГВ, дети/u }).click();
  await expect(block.getByTestId('safety-quote').first()).toContainText(/беременн/iu);
  await shoot(page, 'drug-block');
  await page.goBack();
  await expect(page.getByTestId('safety-card')).toBeVisible({ timeout: 60_000 });

  // Lactation: its own block, from the same instruction.
  await search(page, 'албендазол разрешён ли во время ГВ');
  await expect(page.getByTestId('safety-intent')).toHaveAttribute('data-intent', 'lactation', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('safety-quote').first()).toContainText(/груд/iu, {
    timeout: 60_000,
  });
  await shoot(page, 'lactation');

  // A child's age: the limits with their quotes and one labelled calculation.
  await search(page, 'албендазол ребёнку 3 лет');
  await expect(page.getByTestId('safety-intent')).toHaveAttribute('data-intent', 'age', {
    timeout: 60_000,
  });
  const summary = page.getByTestId('safety-age-summary');
  await expect(summary).toContainText('Рассчитано: 3 года', { timeout: 60_000 });
  await expect(summary).toContainText('строки «Рассчитано» — расчёт приложения', {
    ignoreCase: true,
  });
  const text = (await card.innerText()).toLowerCase();
  expect(text).not.toMatch(/безопасно|можно давать|разрешено/u);
  await shoot(page, 'age');

  // The question goes with both topics and with an age bound.
  await search(page, 'албендазол беременным и при кормлении грудью');
  await expect(page.getByTestId('safety-intent')).toHaveCount(2, { timeout: 60_000 });
});

test('a question about a symptom or a disease shows no drug card', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await search(page, 'давление при беременности');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('safety-card')).toHaveCount(0);
  await search(page, 'кашель у ребёнка 3 лет');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('safety-card')).toHaveCount(0);
});

test('an exact drug name is not read as a question', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await search(page, 'албендазол');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('safety-card')).toHaveCount(0);
});
