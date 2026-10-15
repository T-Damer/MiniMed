import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// RX1/RX2: «Назначение». A 20 kg child: the instruction group «Противоинфекционные» is installed
// through the tool's own download offer (the local release copy, see docs/data-ledger.json; the test
// is skipped when the copy is absent). Metronidazole has a dose sentence the confidence gate lets
// compute (a dose per kilogram): the sentence is quoted, the intake and the course are computed, the
// other sentences sit in one «Ещё N фрагментов» fold, and the «Рецепт» modal carries the text.
// Amoxicillin's children's sentences are age-or-weight tables: they are only quoted, with a link into
// the instruction, and no number is computed. Screenshots: RX1_SHOTS=<directory>.
const SHOTS = process.env['RX1_SHOTS'];
const INSTRUCTION_MODULE = 'minimed.medications.instructions.antiinfectives.ru';

/**
 * Picks the first form that matches and the first strength, when the registry offers a choice and
 * the choice is not made yet. A chosen chip is left alone: tapping the form again resets the
 * strength, and the strength group may then be gone (a form with one strength shows no chips).
 */
async function pickProduct(item: Locator, form: RegExp): Promise<void> {
  const forms = item.getByRole('group', { name: 'Лекарственная форма' }).getByRole('button');
  if (
    (await forms.count()) > 0 &&
    (await forms.and(item.locator('[aria-pressed="true"]')).count()) === 0
  ) {
    const match = forms.filter({ hasText: form });
    const target = ((await match.count()) > 0 ? match : forms).first();
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
  }
  const strengths = item.getByRole('group', { name: 'Дозировка' }).getByRole('button');
  if (
    (await strengths.count()) > 0 &&
    (await strengths.and(item.locator('[aria-pressed="true"]')).count()) === 0
  )
    await strengths.first().click();
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a 20 kg child: amoxicillin and metronidazole are quoted while computed doses are off', async ({
  page,
}) => {
  test.setTimeout(420_000);
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
  await pickProduct(item, /^таблетки диспергируемые$/u);

  // The instruction is not installed yet: the offer names its group and its size.
  await expect(page.getByTestId('prescription-not-installed')).toBeVisible({ timeout: 90_000 });
  const offer = page.locator('.safety-card__offer-button');
  await expect(offer).toContainText(/^Скачать · \d/u, { timeout: 60_000 });
  await expect(page.locator('.module-offer__subtitle')).toContainText('Инструкции группы');
  await shoot(page, 'not-installed');
  await offer.click({ force: true });

  // After the download: the children's sentences of amoxicillin are tables by age or weight, which
  // the confidence gate never turns into numbers. The sentence is quoted with a link, nothing is
  // computed, and no «рассчитано» row appears.
  const none = page.getByTestId('prescription-no-rule');
  await expect(none).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('prescription-source')).toContainText('ГРЛС');
  await expect(none.getByTestId('prescription-quote').first()).toContainText(/мг/u);
  await expect(none.getByRole('link', { name: 'Открыть в инструкции' }).first()).toBeVisible();
  await expect(page.getByTestId('prescription-result')).toHaveCount(0);
  await shoot(page, 'quoted-only');

  // Metronidazole: its dose per kilogram passes the confidence gate, but the release ships with
  // computed doses off (RX5 audit): the sentence is quoted, nothing is computed, and the doctor writes
  // the sign in the recipe text.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/prescription?c=метронидазол&age=2200&w=20`);
  await page.reload();
  const metronidazole = page.getByTestId('prescription-item').filter({ hasText: 'Метронидазол' });
  await expect(metronidazole).toContainText('Метронидазол', { timeout: 90_000 });
  await pickProduct(metronidazole, /таблетки/u);
  const quoted = metronidazole.getByTestId('prescription-no-rule');
  await expect(quoted).toContainText('Расчёт доз в этой версии выключен', { timeout: 120_000 });
  await expect(quoted.getByTestId('prescription-quote').first()).toContainText(/мг/u);
  await expect(metronidazole.getByTestId('prescription-result')).toHaveCount(0);
  await shoot(page, 'result');

  // «Рецепт»: the prescription text with Rp. and the sign the doctor writes under «Текст рецепта»
  // (with computed doses off nothing fills it, and an empty sign is left out of the text).
  await metronidazole.getByText('Текст рецепта').click();
  await metronidazole
    .getByLabel('Способ применения')
    .fill('Внутрь по 1 таблетке 3 раза в день 7 дней.');
  await page.getByTestId('prescription-recipe-button').click();
  const recipe = page.getByTestId('recipe-text');
  await expect(recipe).toContainText('Rp.:');
  await expect(recipe).toContainText('D.S.');
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

test('the search card answers «метронидазол 6 лет 20 кг», opens the instruction and its recipe icon', async ({
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
  await page.getByTestId('search-input').fill('метронидазол 6 лет 20 кг');
  await page.getByTestId('search-submit').click();

  const card = page.getByTestId('dose-card');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText('20 кг');
  await expect(page.getByTestId('search-results')).toBeVisible();

  // The instruction is not installed: the card offers it in place, with its size.
  await pickProduct(card, /таблетки/u);
  const offer = card.locator('.safety-card__offer-button');
  await expect(offer).toContainText(/^Скачать · \d/u, { timeout: 90_000 });
  await expect(card.locator('.module-offer__subtitle')).toContainText('Инструкции группы');
  await shoot(page, 'search-card-offer');
  await offer.dispatchEvent('click');

  // Installed: the sentence of the instruction for a child of 20 kg, quoted (computed doses are off
  // in this release, RX5).
  await expect(card.getByTestId('prescription-quote').first()).toContainText(/мг/u, {
    timeout: 240_000,
  });
  await expect(card.getByTestId('prescription-result')).toHaveCount(0);
  await shoot(page, 'search-card');

  // The recipe icon of the card: the text needs a form and a strength.
  await pickProduct(card, /таблетки/u);
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
