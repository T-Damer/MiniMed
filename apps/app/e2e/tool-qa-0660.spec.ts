import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// QA 0.6.60 findings 3, 8, 11 and 14 (calculators and questionnaires), checked in the real app.

async function openCalculator(page: Page, slug: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/calculators/${slug}`);
  const form = page.locator('.calculator-form').first();
  const offer = page
    .locator('.calculator-pack-required')
    .getByRole('button', { name: /^Скачать(?: · [^·]+)?$/u });
  await expect(form.or(offer).first()).toBeVisible({ timeout: 30_000 });
  if (await offer.isVisible()) {
    await offer.click();
    // The form is rebuilt when the module has finished installing: type only after that.
    await expect(page.getByText(/скачан\. Инструменты доступны офлайн/u).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await expect(form).toBeVisible({ timeout: 60_000 });
}

test('accepts normal values, with no browser tooltip, and says what is missing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openCalculator(page, 'infant-feeding-volume-methods');

  // 4 months against a minimum of 0.33 and a step of 0.1 used to be «invalid» natively.
  const age = page.locator('#calculator-input-ageMonths');
  await age.fill('4');
  await page.locator('#calculator-input-weightKg').fill('6');
  expect(await age.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  expect(await age.evaluate((input: HTMLInputElement) => input.step)).toBe('any');
  await expect(page.getByTestId('calculator-submit')).toBeEnabled();
  await page.getByTestId('calculator-submit').click();
  const result = page.getByTestId('calculator-result');
  await expect(result).toBeVisible();
  // The result says it was saved in its own header: no toast over the heading.
  await expect(result).toContainText('сохранён на устройстве');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

  // Changing a field no longer leaves the result of the old values on the screen.
  await age.fill('');
  await expect(result).toHaveCount(0);
  const hint = page.getByTestId('calculator-missing');
  await expect(hint).toContainText('Нужно заполнить');
  await expect(hint).toContainText('Возраст');
  await expect(page.getByTestId('calculator-submit')).toBeDisabled();

  // A value outside the range is refused by the app, in Russian, not by the browser.
  await age.fill('0.1');
  await page.locator('#calculator-input-weightKg').fill('6');
  await expect(page.getByTestId('calculator-submit')).toBeEnabled();
  await page.getByTestId('calculator-submit').click();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText(
    'значение меньше допустимого минимума 0,33',
  );
});

test('warns about an implausible creatinine and keeps the Cockcroft–Gault range per unit', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openCalculator(page, 'adult-egfr-ckd-epi-2021');
  await page.locator('#calculator-input-ageYears').fill('40');
  await page.locator('#calculator-input-sex').selectOption('female');
  await page.locator('#calculator-input-creatinineUnit').selectOption('umol/l');
  await page.locator('#calculator-input-creatinine').fill('5');
  await page.getByTestId('calculator-submit').click();
  const result = page.getByTestId('calculator-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('почти не встречается');
  // The note is the first thing under the numbers, before the tool's general cautions.
  const warnings = result.locator('.calculator-warnings p');
  await expect(warnings.first()).toContainText('Креатинин ниже 0,2 мг/дл');

  await openCalculator(page, 'cockcroft-gault-creatinine-clearance');
  await page.locator('#calculator-input-ageYears').fill('50');
  await page.locator('#calculator-input-weightKg').fill('70');
  await page.locator('#calculator-input-creatinineUnit').selectOption('umol/l');
  await page.locator('#calculator-input-creatinine').fill('80');
  await page.locator('#calculator-input-sex').selectOption('male');
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByTestId('calculator-result')).toContainText('мл/мин');
});

test('writes score units in the right form', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openCalculator(page, 'wells-pe-probability');
  await page.locator('#calculator-input-dvtSigns').selectOption('1');
  await page.locator('#calculator-input-peMostLikely').selectOption('0');
  await page.locator('#calculator-input-heartRate').fill('110');
  await page.getByTestId('calculator-submit').click();
  // 3 + 1.5 = 4.5 points: a fraction takes «балла», never «баллов» or «балл».
  await expect(page.getByTestId('calculator-result')).toContainText(/4,5 балла/u);
});
