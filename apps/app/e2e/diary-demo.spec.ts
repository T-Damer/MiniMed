import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's diary in demo mode (owner 2026-11-02), against the real diary service on a scratch
// database: one tap, no account details, the demo patients already there and locked, every tool
// working, and each medicine's intake per day on one sheet.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-demo-'));
  const port = 8_890 + test.info().workerIndex;
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

test('«Демо» opens a seeded demo account whose demo patients stay, with intake charts', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  // The app talks to its own origin: send those calls to the scratch service.
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });

  const demo = page.getByRole('button', { name: 'Демо — без регистрации' });
  await expect(demo).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('demo-signin.png') });
  await demo.click();
  const rows = page.locator('.diary-dash-row');
  await expect(rows).toHaveCount(4, { timeout: 120_000 });
  await page.screenshot({ path: testInfo.outputPath('demo-list.png') });
  const doctorId = () =>
    page.evaluate(
      () => JSON.parse(window.localStorage.getItem('minimed.diary.demo.v1') ?? '{}').doctorId,
    );
  const demoDoctor = await doctorId();
  expect(demoDoctor).toBeTruthy();
  await expect(page.getByRole('heading', { name: /Дневники пациентов/u })).toBeVisible();

  // A demo patient cannot be archived (and so not deleted); the other actions stay.
  const first = rows.first().locator('.diary-dash-row__open');
  await first.dispatchEvent('contextmenu');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'QR-код и ссылка для пациента' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'В архив' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The patient page leads with the week: rows that open their chart (owner 2026-11-03), no
  // bare counters; the charts live on a page of their own.
  await first.click();
  const overview = page.getByTestId('diary-overview');
  // Folded at first (DIARY21: the page fits one screen): its verdict in a line, rows one tap away.
  const fold = overview.getByRole('button', { name: /Статистика/u });
  await expect(fold).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  await expect(overview.locator('.diary-overview__stats-note')).not.toHaveText(/считаем/u);
  await page.screenshot({ path: testInfo.outputPath('demo-folded.png') });
  await fold.click();
  await expect(overview.locator('.diary-overview__row').first()).toBeVisible({ timeout: 30_000 });
  await expect(overview).toContainText('Приём лекарств');
  await expect(page.locator('.stat-card')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-overview.png') });

  // The pencil stays on top (DIARY20); a calendar day opens what the patient did that day.
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  await page.locator('.diary-heat__day--today').click();
  const daySheet = page.locator('.diary-day-details');
  await expect(daySheet).toBeVisible();
  await expect(daySheet).toContainText(/Выполнено \d+ из \d+/u);
  await expect(daySheet.getByRole('button', { name: /за пациента/u })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-day.png') });
  await page.keyboard.press('Escape');
  await expect(daySheet).toHaveCount(0);

  // A signal opens its chart: medicine intake, every medicine per day on the same days.
  await overview.locator('[data-signal="intake"]').click();
  await expect(page).toHaveURL(/\/charts\/intake$/u);
  const intake = page.locator('#diary-chart-intake');
  await expect(intake.locator('.diary-chart').first()).toBeVisible();
  await expect(intake.locator('.diary-chart__title').first()).toContainText('в день');
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-intake.png') });
  await page.getByRole('button', { name: 'К пациенту' }).click();
  await expect(overview).toBeVisible();

  // The expand button opens every chart full screen: «Статистика» on one chart first, then each
  // chart, questionnaires included; a tap on the chart opens that day.
  await overview.getByRole('button', { name: 'Все графики на весь экран' }).click();
  await expect(page).toHaveURL(/\/charts$/u);
  await expect(page.locator('.diary-chart--combined')).toBeVisible();
  await expect(page.locator('.diary-chart').nth(2)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('demo-charts.png'), fullPage: true });
  const plot = page.locator('.diary-chart--combined canvas');
  const box = await plot.boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(page.locator('.diary-day-details')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-chart-day.png') });
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.goBack();
  await expect(rows).toHaveCount(4);

  // The fox marks substance use: its craving and amounts are signals and charts too.
  await rows.filter({ hasText: 'Лиса' }).locator('.diary-dash-row__open').click();
  await expect(overview.locator('[data-signal="craving"]')).toBeVisible({ timeout: 30_000 });
  await overview.locator('[data-signal="craving"]').click();
  await expect(page.locator('#diary-chart-craving .diary-chart')).toBeVisible();
  await expect(page.locator('[id^="diary-chart-use-"]').first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-substances.png') });
  await page.goBack();
  // The doctor edits the section on the patient's own screen.
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const useRow = page.locator('.screen-editor').getByText('Употребление').first();
  await expect(useRow).toBeVisible({ timeout: 30_000 });
  await useRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('demo-editor.png') });
  await useRow.click();
  await expect(page.getByText('Спрашивать про тягу')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-editor-use.png') });
  await page.goBack();
  await page.goBack();
  await page.goBack();

  // The same device returns to the same demo, not a fresh one.
  await page.evaluate(() => window.localStorage.removeItem('minimed.diary.doctor.v1'));
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
  await expect(rows).toHaveCount(4, { timeout: 60_000 });
  expect(await doctorId()).toBe(demoDoctor);
});

test('the demo links: the doctor’s opens registration with the demo button in front, the patient’s makes a diary here, the copy stands in offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  let offline = false;
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    offline
      ? route.abort('internetdisconnected')
      : route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );

  // The doctor's QR code: the sign-in already on «Демо», one tap.
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries&demo#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  // The registration form, with the demo button in front and the account button off until filled.
  await expect(page.getByRole('heading', { name: 'Добро пожаловать!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled();
  const demo = page.getByRole('button', { name: 'Демо — без регистрации' });
  await expect(demo).toHaveClass(/ui-button--primary/u);
  await page.screenshot({ path: testInfo.outputPath('demo-link-signin.png') });
  await demo.click();
  const rows = page.locator('.diary-dash-row');
  await expect(rows).toHaveCount(4, { timeout: 120_000 });

  // The patient's QR code: a demo diary with history on this device, connected to the demo doctor.
  await page.goto(`${E2E_ASSET_ORIGIN}/diary/#demo`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Демо-дневник: две недели записей/u)).toBeVisible({
    timeout: 120_000,
  });
  await page.screenshot({ path: testInfo.outputPath('demo-link-patient.png') });

  // The doctor sees it among the demo patients.
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(rows).toHaveCount(5, { timeout: 60_000 });
  await expect(rows.filter({ hasText: 'Гость' })).toHaveCount(1);
  // The copy for work without a network is written a moment after the list loads.
  await page.waitForTimeout(3_000);

  // No network: the list comes from the copy on this device, and says from when.
  offline = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('diary-offline')).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('demo-offline.png') });
});
