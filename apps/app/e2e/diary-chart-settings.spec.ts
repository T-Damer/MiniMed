import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's chart settings on the combined chart (DIARY-CHARTS, owner 2026-11-04): pick the
// lines and the medicine tracks to compare a drug's intake with the curves, the 7-day average on,
// remembered for this patient; a period from presets, arrows and the overview brush. Against the
// real diary service on a scratch database, on the demo account.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-charts-'));
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

/** The names under the combined chart, in order. */
const legend = (page: Page) =>
  page.locator('.diary-combined-legend .diary-combined-legend__item').allInnerTexts();

test('the doctor picks what the combined chart shows, per patient, and its period', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
  const rows = page.locator('.diary-dash-row');
  await expect(rows).toHaveCount(4, { timeout: 120_000 });
  await rows.filter({ hasText: 'Лиса' }).locator('.diary-dash-row__open').click();
  await page.getByRole('button', { name: 'Все графики на весь экран' }).click();
  await expect(page).toHaveURL(/\/charts$/u);
  const chart = page.locator('.diary-chart--combined');
  await expect(chart).toBeVisible();
  // At first everything: the lines, the share of the plan and a track per medicine.
  await expect.poll(() => legend(page)).toContain('Сертралин');
  expect(await legend(page)).toContain('Давление: верхнее');

  // Pressure, pulse and one medicine; the 7-day average over the faded measurements.
  await page.getByRole('button', { name: 'Настроить' }).click();
  const sheet = page.getByRole('dialog', { name: 'Что показать на графике' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Снять все' }).click();
  for (const name of [
    'Давление: верхнее',
    'Давление: нижнее',
    'Пульс и сатурация: пульс, уд/мин',
    'Кветиапин',
  ]) {
    await sheet.getByRole('checkbox', { name, exact: true }).check();
  }
  await sheet.getByRole('switch', { name: 'Среднее за 7 дней' }).click();
  await expect(sheet.getByRole('switch', { name: 'Среднее за 7 дней' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('chart-settings-sheet.png') });
  await sheet.getByRole('button', { name: 'Закрыть' }).click();
  await expect(sheet).toHaveCount(0);
  const chosen = [
    'Давление: верхнее',
    'Давление: нижнее',
    'Пульс и сатурация: пульс, уд/мин',
    'Кветиапин',
    'Пропущено',
  ];
  await expect.poll(() => legend(page)).toEqual(chosen);
  // The missed doses are crosses on the medicine's own track; a tap tells the day and why.
  const cross = chart.locator('.diary-chart__mark').first();
  await expect(cross).toHaveAccessibleName(/^Кветиапин: пропущен/u);
  await cross.click();
  await expect(chart.locator('.diary-mark-card')).toContainText(/Давление: верхнее: \d+/u);
  await page.keyboard.press('Escape');
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('chart-settings-phone.png') });

  // Remembered for this patient: the same choice after a reload.
  await page.reload();
  await expect(chart).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => legend(page)).toEqual(chosen);
  // A name under the chart hides its line.
  await page.getByRole('button', { name: 'Скрыть: Давление: нижнее' }).click();
  await expect.poll(() => legend(page)).not.toContain('Давление: нижнее');

  // The period: a week, a week back, then a day back by the brush's arrow key.
  const dates = page.locator('.diary-chart-period__dates');
  await page.getByText('Неделя', { exact: true }).click();
  const week = await dates.innerText();
  await page.getByRole('button', { name: 'Предыдущий период' }).click();
  await expect(dates).not.toHaveText(week);
  const before = await dates.innerText();
  const brush = page.getByRole('slider', { name: 'Период на графике' });
  await brush.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dates).not.toHaveText(before);
  await expect(brush).toHaveAttribute('aria-valuetext', await dates.innerText());
  // Any dates: the sheet behind the dates button.
  await dates.click();
  const period = page.getByRole('dialog', { name: 'Период' });
  await expect(period.getByText('С', { exact: true })).toBeVisible();
  await period.getByRole('button', { name: 'Готово' }).click();
  await expect(period).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByText('Месяц', { exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('chart-settings-desktop.png') });
});
