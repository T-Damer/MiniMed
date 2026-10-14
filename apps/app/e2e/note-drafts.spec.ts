import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

/** Reload this long after the last keystroke: inside the debounce, just after, long after. */
const RELOAD_DELAYS_MS = [500, 2000, 5000];

async function openNotes(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).first().click();
}

async function openNewPatientForm(page: Page): Promise<void> {
  await openNotes(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await expect(page.getByLabel('Имя или псевдоним')).toBeVisible();
}

async function createPatient(page: Page, name: string): Promise<void> {
  await openNewPatientForm(page);
  await page.getByLabel('Имя или псевдоним').fill(name);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function createVisit(page: Page): Promise<void> {
  await page.getByPlaceholder('Краткая запись осмотра').fill('Осмотр');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();
}

async function openFormData(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Данные для справок и форм/u }).click();
  await expect(page.getByLabel('Место работы / учёбы')).toBeVisible();
}

const diagnosisText = (page: Page) => page.getByLabel('Диагноз осмотра', { exact: true });
const icdCode = (page: Page) => page.getByLabel(/^Код МКБ-10/u);
const workplace = (page: Page) => page.getByLabel('Место работы / учёбы');
const snils = (page: Page) => page.getByLabel(/^СНИЛС/u);

for (const delayMs of RELOAD_DELAYS_MS) {
  test(`visit diagnosis and ICD-10 code survive a reload ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await createPatient(page, `Пациент диагноз ${delayMs}`);
    await createVisit(page);

    await diagnosisText(page).fill(`Бронхиальная астма ${delayMs}`);
    await icdCode(page).fill('j45.0');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(diagnosisText(page)).toHaveValue(`Бронхиальная астма ${delayMs}`);
    await expect(icdCode(page)).toHaveValue('J45.0');
    // There is no explicit save step any more.
    await expect(page.getByRole('button', { name: /Сохранить диагноз/u })).toHaveCount(0);
  });

  test(`a malformed ICD-10 code stays a draft with its error after a reload ${delayMs} ms later`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await createPatient(page, `Пациент код ${delayMs}`);
    await createVisit(page);

    await diagnosisText(page).fill(`Острый бронхит ${delayMs}`);
    await icdCode(page).fill('J4');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(diagnosisText(page)).toHaveValue(`Острый бронхит ${delayMs}`);
    await expect(icdCode(page)).toHaveValue('J4');
    await expect(page.getByText(/Код МКБ-10: ожидается формат/u)).toBeVisible();
    await expect(page.getByText('Черновик: исправьте отмеченное')).toBeVisible();

    // Fixing the code turns the draft into the stored diagnosis.
    await icdCode(page).fill('J20.9');
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(icdCode(page)).toHaveValue('J20.9');
    await expect(page.getByText(/Код МКБ-10: ожидается формат/u)).toHaveCount(0);
    await expect(page.getByText('Черновик: исправьте отмеченное')).toHaveCount(0);
  });

  test(`patient form data survives a reload ${delayMs} ms after typing, an invalid SNILS stays a draft`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await createPatient(page, `Пациент данные ${delayMs}`);
    await openFormData(page);

    await workplace(page).fill(`Школа ${delayMs}`);
    await snils(page).fill('123-4');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(page.getByRole('heading', { name: `Пациент данные ${delayMs}` })).toBeVisible();
    await openFormData(page);
    await expect(workplace(page)).toHaveValue(`Школа ${delayMs}`);
    await expect(snils(page)).toHaveValue('123-4');
    await expect(page.getByText(/СНИЛС: введите 11 цифр/u)).toBeVisible();
    await expect(page.getByRole('button', { name: /Сохранить данные/u })).toHaveCount(0);

    await snils(page).fill('12345678901');
    await page.waitForTimeout(1500);
    await page.reload();
    await openFormData(page);
    await expect(snils(page)).toHaveValue('123-456-789 01');
    await expect(workplace(page)).toHaveValue(`Школа ${delayMs}`);
    await expect(page.getByText(/СНИЛС: введите 11 цифр/u)).toHaveCount(0);
  });

  test(`a new patient form is kept when the page is reloaded ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await openNewPatientForm(page);
    await page.getByLabel('Имя или псевдоним').fill(`Новый ${delayMs}`);
    await page.getByLabel('Масса, кг').fill('12.5');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(page.getByLabel('Имя или псевдоним')).toHaveValue(`Новый ${delayMs}`);
    await expect(page.getByLabel('Масса, кг')).toHaveValue('12.5');
  });
}

test('the fullscreen note toolbar scrolls with arrows, not a scrollbar', async ({ page }) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await openNotes(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Обычная заметка', exact: true }).press('Enter');
  await page.getByLabel('Название заметки').fill('Панель');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  // The toolbar scrolls sideways only on a phone-width screen.
  await page.setViewportSize({ width: 375, height: 812 });
  const next = page.getByRole('button', { name: 'Прокрутить инструменты вправо' });
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.getByRole('button', { name: 'Прокрутить инструменты влево' })).toBeVisible();
});

test('cancelling a new patient form discards its draft', async ({ page }) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await openNewPatientForm(page);
  await page.getByLabel('Имя или псевдоним').fill('Отменённый');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.reload();
  await openNewPatientForm(page);
  await expect(page.getByLabel('Имя или псевдоним')).toHaveValue('');
});

test('the diagnosis typed in one visit does not leak into another after switching', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPatient(page, 'Пациент два осмотра');
  await createVisit(page);
  await diagnosisText(page).fill('Первый диагноз');
  await icdCode(page).fill('J45.0');
  // Closing the visit flushes the diagnosis; the next note opens a second visit.
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await createVisit(page);
  await expect(diagnosisText(page)).toHaveValue('');
  await diagnosisText(page).fill('Второй диагноз');
  await page.reload();
  await expect(diagnosisText(page)).toHaveValue('Второй диагноз');
});
