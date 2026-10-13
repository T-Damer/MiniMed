import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// RX1: «Назначение». A 20 kg child and amoxicillin: the instruction group «Противоинфекционные» is
// installed through the tool's own download offer (the local release copy, see docs/data-ledger.json;
// the test is skipped when the copy is absent), then the dose sentences of the instruction are
// quoted, the intake is computed from them, a second drug brings the interaction check, and the
// «Рецепт» modal and the blank 107-1/у carry the text. Screenshots: RX1_SHOTS=<directory>.
const SHOTS = process.env['RX1_SHOTS'];
const INSTRUCTION_MODULE = 'minimed.medications.instructions.antiinfectives.ru';

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a 20 kg child and amoxicillin: dose sentence, computed intake, recipe and blank', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page, INSTRUCTION_MODULE);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/prescription?c=амоксициллин&age=2200&w=20`);

  const item = page.getByTestId('prescription-item');
  await expect(item).toBeVisible({ timeout: 90_000 });
  await expect(item).toContainText('Амоксициллин');
  await expect(page.getByTestId('prescription-age')).toHaveValue('6 лет');
  await expect(page.getByTestId('prescription-weight')).toHaveValue('20');

  // Several dosage forms: nothing is preselected, the doctor picks the form and the strength.
  await item.getByRole('button', { name: /^таблетки диспергируемые$/u }).click();
  await item.getByRole('button', { name: /^250 мг$/u }).click();

  // The instruction is not installed yet: the offer names its group and its size.
  await expect(page.getByTestId('prescription-not-installed')).toBeVisible({ timeout: 90_000 });
  const offer = page.locator('.safety-card__offer-button');
  await expect(offer).toContainText(/Скачать инструкции группы .* · \d/u, { timeout: 60_000 });
  await shoot(page, 'not-installed');
  await offer.click({ force: true });

  // After the download: the rules that fit a 6-year-old of 20 kg, each with its quoted sentence.
  await expect(page.getByTestId('prescription-rules')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('prescription-source')).toContainText('ГРЛС');
  const quote = page.getByTestId('prescription-quote').first();
  await expect(quote).toContainText(/мг/u);
  await expect(page.getByTestId('prescription-result')).toContainText('На приём');
  await expect(page.getByTestId('prescription-result')).toContainText('Приёмов');
  await shoot(page, 'rules');

  // The course: the packages follow.
  await page.getByTestId('prescription-days-7').click();
  await expect(page.getByTestId('prescription-quantity')).toContainText('упаков', {
    timeout: 30_000,
  });
  await shoot(page, 'result');

  // «Рецепт»: the text of the prescription, with the sign.
  await page.getByTestId('prescription-recipe-button').click();
  const recipe = page.getByTestId('recipe-text');
  await expect(recipe).toContainText('Rp.:');
  await expect(recipe).toContainText('D.S.');
  await expect(recipe).toContainText('в течение 7 дней');
  await shoot(page, 'recipe');
  await page.keyboard.press('Escape');

  // The doctor's choice of the dose never produces a verdict of the app's own.
  const text = (await page.getByTestId('prescription').innerText()).toLowerCase();
  expect(text).not.toMatch(/безопасн|рекомендуем[а-я]* доза для вас/u);
});

test('a drug that has no installed instruction shows no dose of its own', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/prescription?c=амоксициллин&group=child&w=20`);
  const item = page.getByTestId('prescription-item');
  await expect(item).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('prescription-rules')).toHaveCount(0);
  await expect(page.getByTestId('prescription-result')).toHaveCount(0);
});

test('the search card answers «амоксициллин ребенок 20 кг», opens the instruction and its recipe icon', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page, INSTRUCTION_MODULE);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await waitForSearchEditable(page);
  await page.getByTestId('search-input').fill('амоксициллин ребенок 20 кг');
  await page.getByTestId('search-submit').click();

  const card = page.getByTestId('dose-card');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText('20 кг');
  await expect(page.getByTestId('search-results')).toBeVisible();

  // The instruction is not installed: the card offers it in place, with its size.
  await card.getByRole('button', { name: /^таблетки диспергируемые$/u }).click();
  await card.getByRole('button', { name: /^250 мг$/u }).click();
  const offer = card.locator('.safety-card__offer-button');
  await expect(offer).toContainText(/Скачать инструкции группы .* · \d/u, { timeout: 90_000 });
  await shoot(page, 'search-card-offer');
  await offer.dispatchEvent('click');

  // Installed: the sentence of the instruction for a child of 20 kg and the computed intake.
  await expect(card.getByTestId('prescription-quote').first()).toContainText(/мг/u, {
    timeout: 240_000,
  });
  await expect(card.getByTestId('prescription-result')).toContainText('На приём');
  await shoot(page, 'search-card');

  // The recipe icon of the card.
  await card.getByTestId('dose-card-recipe').click();
  await expect(page.getByTestId('recipe-text')).toContainText('Rp.:');
  await shoot(page, 'search-card-recipe');
  await page.keyboard.press('Escape');

  // «Оформить рецепт» opens the tool with the same patient.
  await expect(card.getByTestId('dose-card-open')).toHaveAttribute(
    'href',
    /#\/notes\/prescription\?c=.*w=20/u,
  );
});

test('the drug screen has the recipe icon', async ({ page }) => {
  test.setTimeout(240_000);
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 60_000 });
  await shoot(page, 'drug-screen');
  await page.getByTestId('drug-recipe-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Албендазол', { timeout: 60_000 });
  await shoot(page, 'drug-screen-recipe');
});
