import { expect, type Locator, test } from '@playwright/test';

import { routeInstructionModule } from './medication-module-fixture';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// VIS2/RX: «амоксициллин ребёнок 20 кг». With computed doses off the card only quotes: the sentence
// of the patient's own weight band comes first and is marked, the adult band follows. The local
// release copy of the «Противоинфекционные» instruction group is used (skipped when absent).
const INSTRUCTION_MODULE = 'minimed.medications.instructions.antiinfectives.ru';

async function pickProduct(card: Locator): Promise<void> {
  const forms = card.getByRole('group', { name: 'Лекарственная форма' }).getByRole('button');
  // The bottom navigation floats over the card's lower edge: click through it.
  if ((await forms.count()) > 0) await forms.first().click({ force: true });
  const strengths = card.getByRole('group', { name: 'Дозировка' }).getByRole('button');
  if ((await strengths.count()) > 0) await strengths.first().click({ force: true });
}

test('the dose card quotes the band of the patient first and marks it', async ({ page }) => {
  test.setTimeout(420_000);
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
  await pickProduct(card);
  const offer = card.locator('.safety-card__offer-button');
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await offer.click({ force: true });

  const none = card.getByTestId('prescription-no-rule');
  await expect(none).toBeVisible({ timeout: 240_000 });
  const lead = none.getByTestId('prescription-quote').first();
  // The first sentence is the patient's own, marked with what it was matched on.
  await expect(lead).toHaveClass(/prescription__quote--fit/u);
  await expect(lead.getByTestId('prescription-quote-fit')).toContainText('Подходит пациенту по');
  // The adult band is not the first thing the card says.
  await expect(lead).not.toContainText('Взрослые и дети старше 13 лет');
  // Nothing is computed.
  await expect(card.getByTestId('prescription-result')).toHaveCount(0);

  // The recipe sheet shows its tools, and says what the recipe needs.
  await card.getByTestId('dose-card-recipe').click();
  const sheet = page.getByRole('dialog', { name: 'Рецепт' });
  await expect(sheet.getByRole('button', { name: 'Печать' })).toBeVisible();
});
