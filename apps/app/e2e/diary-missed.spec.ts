import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// Why a dose was missed (DIARY22, owner 2026-11-03: «ask why — this is important»): the skip sheet
// asks with one tap, and an intake that passed unmarked is asked about on the today screen.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-missed-'));
  const port = 8_930 + test.info().workerIndex;
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
    .poll(async () => (await fetch(`${service}/api/health`).catch(() => undefined))?.ok ?? false, {
      timeout: 20_000,
    })
    .toBe(true);
});

test.afterAll(() => {
  server?.kill();
  rmSync(directory, { recursive: true, force: true });
});

test('a skipped dose says why, and a dose that passed unmarked is asked about', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/diary/#demo`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Демо-дневник: две недели записей/u)).toBeVisible({
    timeout: 120_000,
  });

  // The skip sheet: «Что помешало?» with one-tap reasons.
  await page.getByRole('button', { name: 'Предыдущий день' }).click();
  const dose = page.locator('.care-row').filter({ hasText: /мг/u }).first();
  await dose.click();
  await page.getByRole('button', { name: 'Пропустил(а)' }).last().click();
  await expect(page.getByText('Что помешало?')).toBeVisible();
  await page.getByRole('button', { name: 'Плохо переношу' }).click();
  await expect(page.getByRole('button', { name: 'Плохо переношу' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: testInfo.outputPath('skip-reason.png') });

  // Yesterday's mark removed: today asks what happened, until it is answered.
  await page.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Точно удалить?' }).click();
  await expect(page.getByText('Что помешало?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Следующий день' }).click();
  const missed = page.locator('.diary-today__missed');
  await expect(missed).toBeVisible();
  await expect(missed).toContainText('вчера');
  await page.screenshot({ path: testInfo.outputPath('missed.png') });
  await missed.getByRole('button', { name: 'Пропустил(а)' }).first().click();
  await page.getByRole('button', { name: 'Забыл(а)' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(missed).toHaveCount(0);
});
