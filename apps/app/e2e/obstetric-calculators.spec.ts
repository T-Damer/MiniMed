import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('calculates an EDD by LMP and writes the result to a patient note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/calculators$/u);

  await page.getByRole('button', { name: 'Открыть раздел «Акушерство»' }).click();
  await expect(page.getByRole('heading', { name: 'Акушерство' })).toBeVisible();
  const installSection = page.getByRole('button', {
    // «Скачать раздел», «Скачать дополнения» or «Есть обновление», then the section title.
    name: /^(Скачать раздел|Скачать дополнения|Есть обновление) — Акушерство$/u,
  });
  const openEdd = page.getByTestId('calculator-open-obstetric-edd-lmp');
  await expect(installSection.or(openEdd).first()).toBeVisible();
  if (await installSection.isVisible()) await installSection.click();

  await openEdd.click();
  await expect(
    page.getByRole('heading', { name: 'ПДР по дате последней менструации' }),
  ).toBeVisible();

  await page.getByLabel('Дата последней менструации').fill('2026-05-01');
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByTestId('calculator-result')).toContainText('5 февраля 2027 г.');

  await page.getByTestId('calculator-save-note').click();
  await page.locator('.calculator-note-panel__input').fill('Пациентка калькулятора');
  await page.getByRole('button', { name: 'Записать результат' }).click();
  await expect(page.getByText('Расчёт записан в карточку пациента.')).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Пациентка калькулятора' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('5 февраля 2027 г.');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('5 февраля 2027 г.');
});

test('scores cervical readiness with the Bishop score calculator', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Акушерство»' }).click();
  const installSection = page.getByRole('button', {
    // «Скачать раздел», «Скачать дополнения» or «Есть обновление», then the section title.
    name: /^(Скачать раздел|Скачать дополнения|Есть обновление) — Акушерство$/u,
  });
  const openBishop = page.getByTestId('calculator-open-obstetric-bishop-score');
  await expect(installSection.or(openBishop).first()).toBeVisible();
  if (await installSection.isVisible()) await installSection.click();

  await openBishop.click();
  await expect(page.getByRole('heading', { name: 'Шкала Бишопа' })).toBeVisible();

  await page.getByLabel('Раскрытие шейки матки').selectOption({ label: '3–4 см (2)' });
  await page.getByLabel('Сглаживание шейки матки').selectOption({ label: '60–70% (2)' });
  await page.getByLabel('Положение головки (станция)').selectOption({ label: '−2 (1)' });
  await page.getByLabel('Консистенция шейки матки').selectOption({ label: 'Средняя (1)' });
  await page.getByLabel('Позиция шейки матки').selectOption({ label: 'Срединное положение (1)' });
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByTestId('calculator-result')).toContainText('7');
});
