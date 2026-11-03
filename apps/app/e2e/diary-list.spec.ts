import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's patient list (owner 2026-11-03): search, counters in the header that filter, the
// order menu next to the search, the title centred with the header's buttons, and a sheet that
// leaves with an animation when it closes.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-list-'));
  const port = 8_920 + test.info().workerIndex;
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

test('search, counters and the order menu shape the list; the title sits level with the buttons', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
  const rows = page.locator('.diary-dash-row');
  await expect(rows).toHaveCount(4, { timeout: 120_000 });

  // The title is centred on the header's buttons (it sat above their middle).
  const middle = (selector: string): Promise<number> =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top + box.height / 2;
      });
  const title = await middle('.diary-dash__title');
  const button = await middle('.page__right-actions button');
  expect(Math.abs(title - button)).toBeLessThan(1.5);

  // A greeting under the title, and the counters in the band.
  await expect(page.locator('.page__description')).not.toBeEmpty();
  await expect(page.locator('.diary-counters__chip')).toHaveCount(3);

  // Search narrows the list as the doctor types.
  const search = page.getByRole('searchbox', { name: 'Поиск пациента' });
  await search.fill('мед');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Медведь');
  await search.fill('ёж нет такого');
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Никого не нашли' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать всех' }).click();
  await expect(rows).toHaveCount(4);
  await expect(search).toHaveValue('');

  // A counter filters: «Срочные» keeps the patient with an urgent mark; again, and all are back.
  const urgent = page.locator('.diary-counters__chip').first();
  await urgent.click();
  await expect(urgent).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(1);
  await urgent.click();
  await expect(rows).toHaveCount(4);

  // The order lives in a menu beside the search; choosing «А–Я» puts the names in order.
  await page.getByRole('button', { name: /^Порядок списка/u }).click();
  await page.getByRole('menuitem', { name: /^А–Я/u }).click();
  const names = await rows.locator('.diary-dash-row__name').allInnerTexts();
  const urgentFirst = names.slice(1);
  expect(urgentFirst).toEqual([...urgentFirst].sort((a, b) => a.localeCompare(b, 'ru')));
});

test('a sheet that closes plays its exit instead of vanishing', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
    route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
  );
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  const demo = page.getByRole('button', { name: 'Демо — без регистрации' });
  await expect(demo).toBeVisible();
  await demo.click();
  await expect(page.locator('.diary-dash-row')).toHaveCount(4, { timeout: 120_000 });
  await page.locator('.diary-dash-row__open').first().click();
  await expect(page.getByTestId('diary-overview')).toBeVisible({ timeout: 30_000 });

  await page.locator('.diary-heat__day--today').click();
  const sheet = page.locator('.diary-day-details');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Закрыть' }).click();
  // Frame by frame: the sheet is still on screen while it moves down, and then it is gone.
  const tops = await page.evaluate(
    () =>
      new Promise<number[]>((resolveTops) => {
        const seen: number[] = [];
        const started = performance.now();
        const tick = (): void => {
          const panel = document.querySelector('.overlay-dialog');
          if (panel) seen.push(Math.round(panel.getBoundingClientRect().top));
          if (performance.now() - started < 700) requestAnimationFrame(tick);
          else resolveTops(seen);
        };
        tick();
      }),
  );
  expect(new Set(tops).size).toBeGreaterThan(3);
  expect(tops.at(-1) ?? 0).toBeGreaterThan(tops[0] ?? 0);
  await expect(page.locator('.overlay-dialog')).toHaveCount(0);
});
