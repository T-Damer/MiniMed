import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('stretches calculator cards across a narrow single-column grid', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 });
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();

  const dimensions = await page.locator('.calculator-catalog-grid').evaluate((grid) => {
    const card = grid.querySelector<HTMLElement>('.calculator-card');
    if (!card) throw new Error('calculator card missing');
    return {
      grid: grid.getBoundingClientRect().width,
      card: card.getBoundingClientRect().width,
    };
  });

  expect(dimensions.card).toBeCloseTo(dimensions.grid, 0);
});

test('uses one patient field and offers the protected patient unlock action', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
  await page.getByTestId('calculator-open-body-surface-area-mosteller').click();

  const patientField = page.getByRole('combobox', {
    name: 'Пациент / случай — необязательно',
    exact: true,
  });
  await expect(patientField).toHaveCount(1);
  await patientField.fill('Неизвестный пациент');
  await page.getByRole('option', { name: 'Разблокировать пациентов', exact: true }).click();

  await expect(page).toHaveURL(/#\/notes\/patients$/u);
});

test('calculates body surface area and writes the result to a patient note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await expect(page.locator('.calculator-launch-button')).toHaveCount(0);
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/calculators$/u);
  await expect(page.getByRole('heading', { name: 'Калькуляторы' })).toBeVisible();

  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
  const anthropometryDownload = page.getByRole('button', {
    name: 'Скачать раздел «Антропометрия»',
  });
  if (await anthropometryDownload.count()) {
    await anthropometryDownload.click();
  }
  await page.getByTestId('calculator-open-body-surface-area-mosteller').click();
  await expect(
    page.getByRole('heading', { name: 'Площадь поверхности тела — Mosteller' }),
  ).toBeVisible();

  await page
    .getByRole('combobox', { name: 'Пациент / случай — необязательно', exact: true })
    .fill('Пациент калькулятора');
  await page.getByLabel('Рост, см').fill('170');
  await page.getByLabel('Масса, кг').fill('70');
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByText('Расчёт сохранён локально.')).toBeVisible();
  await expect(page.getByTestId('calculator-result')).toContainText('1,82 м²');

  await page.getByTestId('calculator-save-note').click();
  await page.getByRole('button', { name: 'Записать результат' }).click();
  await expect(page.getByText('Расчёт записан в карточку пациента.')).toBeVisible();

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
