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

  // The patient page: every medicine's intake per day on one sheet, the same days for all.
  await first.click();
  await page.getByRole('button', { name: 'Графики приёма по дням' }).click();
  const sheet = page.getByRole('dialog', { name: 'Приём лекарств по дням' });
  await expect(sheet.locator('.diary-chart').first()).toBeVisible();
  expect(await sheet.locator('.diary-chart').count()).toBeGreaterThan(0);
  await expect(sheet.locator('.diary-chart__title').first()).toContainText('в день');
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('demo-intake.png') });

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
