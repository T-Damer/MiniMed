import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// «Новый пациент» built from scratch (owner 2026-11-10): numbered steps on the left, empty to begin
// with, the patient's blue read-only screen on the right (a sheet on a phone), the past treatment
// written right after the patient is created.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-new-patient-'));
  const port = 8_980 + test.info().workerIndex;
  service = `http://127.0.0.1:${port}`;
  server = spawn('bun', ['apps/diary-server/src/main.ts'], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      DIARY_SIGNUP: 'open',
      DIARY_DB: join(directory, 'diary.db'),
      DIARY_PORT: String(port),
    },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${service}/api/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test.afterAll(() => {
  server?.kill();
  rmSync(directory, { recursive: true, force: true });
});

const STEPS = [
  'Профиль',
  'Прошлое лечение',
  'Лечение сейчас',
  'Что отмечает пациент',
  'Приёмы, анализы, задания',
  'Связь и помощь',
] as const;

/** Signs a new doctor up on the scratch service and opens «Новый пациент». */
async function openNewPatient(page: Page, email: string): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
  });
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByText('Регистрация', { exact: true }).click();
  await page.getByLabel('Почта', { exact: true }).fill(email);
  await page.getByLabel('Как вас подписать для пациентов').fill('Д-р Новикова');
  await page.getByLabel('Новый пароль (от 8 символов)').fill('new-patient-pass-2026');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: 'Я сохранил(а) код' }).click({ timeout: 60_000 });
  await page.getByTestId('diary-create-patient').click({ timeout: 60_000 });
  await expect(page.getByLabel('Имя или псевдоним')).toBeVisible();
}

test('wide: six steps, empty to begin with, a blue read-only patient screen beside them', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewPatient(page, 'wide@example.test');

  // Each step is a card with its own h2 and one plain line.
  for (const [index, title] of STEPS.entries()) {
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    await expect(page.locator('.form-step__number').nth(index)).toHaveText(String(index + 1));
  }

  // Nothing is pre-filled: no medicine, no marks; the patient's screen has only what every diary has.
  const view = page.getByTestId('patient-view');
  await expect(view).toBeVisible();
  await expect(view.getByRole('heading', { level: 2, name: 'Так видит пациент' })).toBeVisible();
  await expect(view.locator('.care-row')).toHaveCount(1);
  await expect(view.locator('.care-row')).toContainText('Рассказать врачу');
  await expect(page.locator('.form-rows')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wide-empty.png') });

  // The patient's side is blue, the doctor's is not.
  const blue = await view.evaluate((element) => {
    const channels = (value: string): number[] =>
      (value.match(/\d+/gu) ?? []).slice(0, 3).map(Number);
    const tab = element.querySelector('.patient-view__title');
    const number = document.querySelector('.form-step__number');
    if (!tab || !number) return undefined;
    return {
      patient: channels(getComputedStyle(tab).backgroundColor),
      doctor: channels(getComputedStyle(number).backgroundColor),
    };
  });
  const [pr = 0, , pb = 0] = blue?.patient ?? [];
  const [dr = 0, dg = 0, db = 0] = blue?.doctor ?? [];
  expect(pb).toBeGreaterThan(pr + 40);
  expect(dg).toBeGreaterThanOrEqual(db);
  expect(dr).toBeLessThan(120);

  // A medicine added on the left shows on the right at once.
  await page.getByRole('button', { name: 'Лекарство', exact: true }).click();
  const drug = page.getByRole('combobox', { name: 'Препарат' });
  await drug.fill('Сертралин');
  await drug.press('Tab');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(view.locator('.care-row')).toHaveCount(2);
  await expect(view.locator('.care-row').filter({ hasText: 'Сертралин' })).toBeVisible();
  await expect(page.locator('.form-rows .form-row')).toHaveCount(1);

  // The preview is read-only: no fields, a tap on a row ticks nothing and edits nothing, it only
  // takes the doctor to the step where the row is edited.
  await expect(view.locator('input, textarea, select')).toHaveCount(0);
  const row = view.locator('.care-row').filter({ hasText: 'Сертралин' });
  await row.getByRole('button', { name: /Сертралин.*показать в форме/u }).click();
  await expect(row.locator('.care-row__check')).toHaveAttribute('aria-pressed', 'false');
  await expect(row).not.toHaveClass(/care-row--done/u);
  await expect(page.getByRole('heading', { level: 2, name: 'Лечение сейчас' })).toBeFocused();
  await expect(page.locator('.form-rows .form-row')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Past treatment typed before the patient exists stays in the draft…
  await page.getByLabel('Имя или псевдоним').fill('Ёжик Колючий');
  await page.getByTestId('med-history-add').click();
  const past = page.getByRole('combobox', { name: 'Препарат' });
  await past.fill('Амитриптилин');
  await past.press('Tab');
  await page.getByTestId('med-history-save').click();
  await expect(page.getByTestId('med-history-list')).toContainText('Амитриптилин');
  await page.screenshot({ path: testInfo.outputPath('wide-filled.png') });

  // …and is written right after the patient is created: the patient page counts it.
  await page.getByRole('button', { name: 'Добавить пациента' }).click();
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Готово' }).first().click();
  await page.getByRole('button', { name: 'К списку' }).click();
  await page.locator('.diary-dash-row').filter({ hasText: 'Ёжик Колючий' }).click();
  await expect(page.getByTestId('med-history-card')).toContainText('1 препарат', {
    timeout: 60_000,
  });
});

test('wide: a diary with no medicine and no marks can be created', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewPatient(page, 'bare@example.test');
  await page.getByLabel('Имя или псевдоним').fill('Пустой');
  await page.getByRole('button', { name: 'Добавить пациента' }).click();
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeEnabled({
    timeout: 60_000,
  });
});

test('phone: «Как увидит пациент» opens the patient screen in a sheet', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewPatient(page, 'phone@example.test');

  // No second column on a phone, one button instead.
  await expect(page.getByTestId('patient-view')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone-form.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: 'Лекарство', exact: true }).click();
  await page.getByRole('combobox', { name: 'Препарат' }).fill('Сертралин');
  await page.getByRole('combobox', { name: 'Препарат' }).press('Tab');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByTestId('patient-view-open').click();
  const sheet = page.getByRole('dialog', { name: 'Как увидит пациент' });
  await expect(sheet.getByTestId('patient-view')).toBeVisible();
  await expect(sheet.locator('.care-row').filter({ hasText: 'Сертралин' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('phone-view.png') });

  // A tap on a row closes the sheet and takes the doctor to its step.
  await sheet
    .locator('.care-row')
    .filter({ hasText: 'Сертралин' })
    .getByRole('button', { name: /показать в форме/u })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Лечение сейчас' })).toBeFocused();
});

test('wide: the patient screen keeps its title below the pinned header at the end of a long form', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewPatient(page, 'sticky@example.test');
  for (const kind of ['Самочувствие', 'Настроение', 'Пульс и давление', 'Вес и рост', 'Глюкоза']) {
    await page.getByRole('button', { name: kind, exact: true }).click();
    const sheet = page.getByRole('dialog');
    if (await sheet.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  }
  // To the very end of the form: the sticky column meets the end of its row there.
  await page.getByRole('button', { name: 'Добавить пациента' }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(400);
  const title = page.getByTestId('patient-view').locator('.patient-view__title');
  const seen = await title.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
    return {
      top: Math.round(box.top),
      covered: !(hit && (element === hit || element.contains(hit))),
      hit: String(hit?.className ?? ''),
    };
  });
  expect(seen.covered, JSON.stringify(seen)).toBe(false);
});
