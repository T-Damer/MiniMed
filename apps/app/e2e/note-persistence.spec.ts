import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

/** Reload at each of these delays after typing: inside the debounce, just after, and long after. */
const RELOAD_DELAYS_MS = [500, 2000, 5000, 12000];

async function openNotes(page: Page): Promise<void> {
  // The tab exists before the core has opened (the section then sits under the files tab).
  await page.getByRole('button', { name: 'Заметки', exact: true }).first().click();
}

async function createPlainNote(page: Page, title: string): Promise<void> {
  await openNotes(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Обычная заметка', exact: true }).press('Enter');
  await page.getByLabel('Название заметки').fill(title);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page).toHaveURL(/\/records\/new(?:\?|$)/u);
}

async function createPatient(page: Page, name: string): Promise<void> {
  await openNotes(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await page.getByLabel('Имя или псевдоним').fill(name);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

const visitNote = (page: Page) => page.getByPlaceholder('Краткая запись осмотра');
const visitRows = (page: Page) => page.locator('.patient-workspace__episode');

for (const delayMs of RELOAD_DELAYS_MS) {
  test(`plain note text survives a reload ${delayMs} ms after typing`, async ({ page }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await createPlainNote(page, `Заметка ${delayMs}`);
    const editor = page.getByLabel(/^Новая заметка для /u);
    const text = `Тестовая запись ${delayMs} мс`;
    await editor.click();
    await page.keyboard.type(text);
    await page.waitForTimeout(delayMs);
    await page.reload();
    await expect(page.getByLabel(/^Новая заметка для /u)).toContainText(text);
  });
}

test('plain note text typed and reloaded at once is kept by the flush on page hide', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPlainNote(page, 'Заметка сразу');
  await page.getByLabel(/^Новая заметка для /u).click();
  await page.keyboard.type('Сразу после ввода');
  await page.reload();
  await expect(page.getByLabel(/^Новая заметка для /u)).toContainText('Сразу после ввода');
});

for (const delayMs of RELOAD_DELAYS_MS) {
  test(`visit note typed before «Создать осмотр» survives a reload ${delayMs} ms later`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mountBuiltApp(page, { persistentOrigin: true });
    await createPatient(page, `Пациент ${delayMs}`);
    await visitNote(page).fill(`Кашель третий день ${delayMs}`);
    await page.waitForTimeout(delayMs);
    await page.reload();
    await expect(page.getByRole('heading', { name: `Пациент ${delayMs}` })).toBeVisible();
    await expect(visitNote(page)).toHaveValue(`Кашель третий день ${delayMs}`);
    await expect(visitRows(page)).toHaveCount(1);
  });
}

test('visit note typed into an open visit survives a reload, at once and later', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPatient(page, 'Пациент открытый осмотр');
  await visitNote(page).fill('Первичный осмотр');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();
  // The note stays in its field after the visit is created.
  await expect(visitNote(page)).toHaveValue('Первичный осмотр');

  await visitNote(page).fill('Первичный осмотр, добавлено: хрипов нет');
  await page.reload();
  await expect(visitNote(page)).toHaveValue('Первичный осмотр, добавлено: хрипов нет');
  await expect(visitRows(page)).toHaveCount(1);

  await visitNote(page).fill('Вторая правка через паузу');
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(visitNote(page)).toHaveValue('Вторая правка через паузу');
});

test('a closed visit keeps and shows its note; a new note opens a new visit', async ({ page }) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPatient(page, 'Пациент закрытый осмотр');
  await visitNote(page).fill('Запись первого осмотра');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(visitRows(page).first()).toContainText('Закрыт');
  await expect(page.locator('.patient-workspace__episode-text')).toHaveText(
    'Запись первого осмотра',
  );
  await expect(visitNote(page)).toHaveValue('');

  await visitNote(page).fill('Запись второго осмотра');
  await expect(visitRows(page)).toHaveCount(2);
  await page.reload();
  await expect(visitNote(page)).toHaveValue('Запись второго осмотра');
  await expect(visitRows(page)).toHaveCount(2);
});

test('«Создать осмотр» twice leaves one open visit', async ({ page }) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPatient(page, 'Пациент двойной тап');
  await visitNote(page).fill('Один осмотр');
  const create = page.getByRole('button', { name: 'Создать осмотр', exact: true });
  await create.dblclick();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();
  await expect(visitRows(page)).toHaveCount(1);
  await expect(create).toHaveCount(0);
  await page.reload();
  await expect(visitRows(page)).toHaveCount(1);
  await expect(visitNote(page)).toHaveValue('Один осмотр');
});

test('visit status and its icon buttons do not overlap or leave the row', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true });
  await createPatient(page, 'Пациент строка');
  await visitNote(page).fill('Запись');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  const row = visitRows(page).first();
  await expect(row).toContainText('Открыт');
  const rowBox = await row.boundingBox();
  const statusBox = await row.locator('.patient-workspace__episode-status').boundingBox();
  const closeBox = await row.getByRole('button', { name: 'Закрыть', exact: true }).boundingBox();
  const titleBox = await row.locator('.patient-workspace__episode-title').boundingBox();
  if (!rowBox || !statusBox || !closeBox || !titleBox) throw new Error('episode row not laid out');
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x + 1);
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(closeBox.x + 1);
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
});
