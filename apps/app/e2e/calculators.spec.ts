import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('calculates body surface area and writes the result to a patient note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.getByRole('button', { name: 'Открыть медицинские калькуляторы' }).click();
  await expect(page.getByRole('heading', { name: 'Медицинские калькуляторы' })).toBeVisible();

  await page.getByTestId('calculator-open-body-surface-area-mosteller').click();
  await expect(
    page.getByRole('heading', { name: 'Площадь поверхности тела — Mosteller' }),
  ).toBeVisible();

  await page.getByLabel('Пациент / случай — необязательно').fill('Пациент калькулятора');
  await page.getByLabel('Рост, см').fill('170');
  await page.getByLabel('Масса, кг').fill('70');
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByText('Расчёт сохранён локально.')).toBeVisible();
  await expect(page.getByTestId('calculator-result')).toContainText('1,82 м²');

  await page.getByTestId('calculator-save-note').click();
  await page.getByRole('button', { name: 'Записать результат' }).click();
  await expect(page.getByText('Расчёт записан в карточку пациента.')).toBeVisible();

  await page.getByRole('button', { name: 'Закрыть калькуляторы' }).click();
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Пациент калькулятора' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('Площадь поверхности тела');
  await expect(page.locator('.patient-note-record')).toContainText('1,82 м²');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('Площадь поверхности тела');
});
