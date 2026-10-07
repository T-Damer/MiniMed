import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// Set VAC2_CAPTURE_DIR to write screenshots and the PDF of the diary sheet.
const CAPTURE_DIR = process.env['VAC2_CAPTURE_DIR'];

async function capture(page: Page, name: string, fullPage = false): Promise<void> {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${CAPTURE_DIR}/${name}.png`, fullPage });
}

async function createPatient(page: Page, name: string, birthDate?: string): Promise<void> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  const unlock = page.getByRole('button', { name: /^(Понятно, продолжить|Открыть)$/u });
  const heading = page.getByRole('heading', { name: 'Новая карточка пациента' });
  await unlock.or(heading).first().waitFor();
  if (await unlock.isVisible()) await unlock.click();
  await expect(heading).toBeVisible();
  await page.getByLabel('Имя или псевдоним').fill(name);
  if (birthDate) await page.getByLabel('Дата рождения').fill(birthDate);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function openPlan(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/notes/vaccination?part=plan';
  });
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
}

async function chooseChild(page: Page, name: string): Promise<void> {
  const field = page.getByRole('combobox', { name: /Ребёнок/u });
  await field.fill(name);
  await page.getByRole('option', { name }).click();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('patient: the plan is attached to a card, kept with it and printed as the diary for the mother', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await createPatient(page, 'Аня Тестова', '2025-03-15');
  await createPatient(page, 'Миша без даты');
  await openPlan(page);

  // Nothing is chosen yet: no plan, the way to «only calculate» is one control away.
  await expect(page.locator('.vax-plan__entry')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Только расчёт', exact: true })).toBeAttached();

  await chooseChild(page, 'Аня Тестова');
  await expect(page.locator('.vax-child__fact-value')).toHaveText('15.03.2025');
  await expect(page.getByText('из карточки')).toBeVisible();
  await expect(page.locator('.vax-plan__entry')).toHaveCount(14);
  await expect(page.getByText('План ещё не прикреплён к карточке')).toBeVisible();
  await capture(page, 'vac2-plan-patient-1280', true);

  await page.getByRole('button', { name: 'Прикрепить план к карточке' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'План прикреплён' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить запись о плане' })).toBeVisible();

  // The record outlives the page: leave, come back, choose the card again.
  await page.evaluate(() => {
    window.location.hash = '#/notes';
  });
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toHaveCount(0);
  await openPlan(page);
  await chooseChild(page, 'Аня Тестова');
  await expect(page.getByText(/План прикреплён к карточке \d{2}\.\d{2}\.\d{4}/u)).toBeVisible();

  // The diary sheet: the chart of the calendar, the child, a date under each dose, empty marks.
  await page.getByRole('button', { name: 'Дневник для мамы' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Дневник прививок');
  const frame = page.frameLocator('iframe[title="Предпросмотр дневника прививок"]');
  await expect(frame.locator('.vax-diary__infection')).toHaveText([
    'Туберкулёз',
    'Вирусный гепатит B',
    'Пневмококковая инфекция',
    'Коклюш',
    'Дифтерия',
    'Столбняк',
    'Полиомиелит',
    'Гемофильная инфекция',
    'Корь',
    'Краснуха',
    'Эпидемический паротит',
    'Грипп',
  ]);
  await expect(frame.locator('.vax-diary__child-value').first()).toHaveText('Аня Тестова');
  await expect(frame.locator('.vax-diary__child-value').nth(1)).toHaveText('15.03.2025');
  await expect(
    frame.locator('tbody tr').first().locator('.vax-diary__dose-date').first(),
  ).toHaveText('≈ 17.03.25');
  await capture(page, 'vac2-diary-preview-1280');

  const html = (await page
    .locator('iframe[title="Предпросмотр дневника прививок"]')
    .getAttribute('srcdoc')) as string;
  const sheet = await page.context().newPage();
  try {
    await sheet.setContent(html);
    await sheet.emulateMedia({ media: 'print' });
    const pdf = await sheet.pdf({ preferCSSPageSize: true, printBackground: true });
    const source = pdf.toString('latin1');
    const pages = (source.match(/\/Type\s*\/Page(?![a-z])/gu) ?? []).length;
    expect(pages).toBe(1);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(source);
    expect(Number(box?.[1])).toBeCloseTo(841.89, 0);
    expect(Number(box?.[2])).toBeCloseTo(595.28, 0);
    const spill = await sheet.evaluate(() => ({
      width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(spill.width).toBeLessThanOrEqual(1);
    if (CAPTURE_DIR) {
      mkdirSync(CAPTURE_DIR, { recursive: true });
      writeFileSync(`${CAPTURE_DIR}/vac2-diary-personal.pdf`, pdf);
      await sheet.setViewportSize({ width: 1123, height: 794 });
      await sheet.screenshot({ path: `${CAPTURE_DIR}/vac2-diary-personal.png`, fullPage: true });
    }
  } finally {
    await sheet.close();
  }
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

  // A card without a birth date: the date typed here is written to the card on attaching.
  await chooseChild(page, 'Миша без даты');
  await expect(page.locator('.vax-plan__entry')).toHaveCount(0);
  await page.getByLabel('Дата рождения ребёнка').fill('2026-01-10');
  await expect(page.locator('.vax-plan__entry')).toHaveCount(14);
  await page.getByRole('button', { name: 'Прикрепить план к карточке' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'План прикреплён' })).toBeVisible();
  await chooseChild(page, 'Аня Тестова');
  await chooseChild(page, 'Миша без даты');
  await expect(page.locator('.vax-child__fact-value')).toHaveText('10.01.2026');
  await expect(page.getByText('из карточки')).toBeVisible();

  // Patient data is not left outside the vault.
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(stored).not.toContain('Аня Тестова');
  expect(stored).not.toContain('2025-03-15');
  expect(page.url()).not.toContain('2025-03-15');
});

test('calculate only: a birth date gives the plan and the sheet, nothing is saved', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openPlan(page);
  await capture(page, 'vac2-plan-empty-390');

  await page.getByRole('radio', { name: 'Только расчёт', exact: true }).check({ force: true });
  await expect(page.getByText(/нигде не записываются/u)).toBeVisible();
  const birth = page.getByLabel('Дата рождения ребёнка');
  await birth.fill('2025-03-15');
  await expect(page.locator('.vax-plan__entry')).toHaveCount(14);
  await expect(page.locator('.vax-plan__entry[data-status="current"]')).toHaveCount(1);
  await expect(
    page.locator('.vax-plan__entry[data-row-id="n-06"] .vax-plan__date-value'),
  ).toContainText('≈');
  await expect(
    page.locator('.vax-plan__entry[data-row-id="n-11"] .vax-plan__dose-label'),
  ).toHaveText('RV2 · ОПВ');
  await expect(page.getByRole('button', { name: 'Прикрепить план к карточке' })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await capture(page, 'vac2-plan-quick-390', true);

  await page.getByRole('button', { name: /Условия из порядка проведения прививок/u }).click();
  await expect(
    page.getByText(
      'Допускается введение вакцин (за исключением вакцин для профилактики туберкулеза)',
    ),
  ).toBeVisible();

  // The sheet without a name has a blank line for it and still carries the planned dates.
  await page.getByRole('button', { name: 'Дневник для мамы' }).click();
  const frame = page.frameLocator('iframe[title="Предпросмотр дневника прививок"]');
  await expect(frame.locator('.vax-diary__child-value').first()).toHaveText('');
  await expect(frame.locator('.vax-diary__child-value').nth(1)).toHaveText('15.03.2025');
  await capture(page, 'vac2-diary-preview-390');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();

  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(stored).not.toContain('2025-03-15');
  expect(page.url()).not.toContain('2025-03-15');
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ''),
  );
  expect(databases.filter((name) => /patient/iu.test(name))).toEqual([]);

  await birth.fill('2099-01-01');
  await expect(page.getByRole('alert')).toContainText('не может быть позже сегодняшнего дня');
  await expect(page.getByRole('button', { name: 'Дневник для мамы' })).toHaveCount(0);

  // A blank sheet needs no data at all.
  await birth.fill('');
  await expect(page.locator('.vax-plan__entry')).toHaveCount(0);
});

test('the page layout holds at phone and desktop widths', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/notes/vaccination';
  });
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
  await capture(page, 'vac2-national-390');
  // Back button and print share the first row of the page header.
  const back = await page.getByRole('button', { name: 'Назад' }).first().boundingBox();
  const print = await page.getByRole('button', { name: 'Печать', exact: true }).boundingBox();
  expect(Math.abs((back?.y ?? 0) - (print?.y ?? 999))).toBeLessThan(24);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
  await capture(page, 'vac2-national-1280');
  await page.evaluate(() => {
    window.location.hash = '#/notes/vaccination?part=plan';
  });
  await capture(page, 'vac2-plan-empty-1280');
});
