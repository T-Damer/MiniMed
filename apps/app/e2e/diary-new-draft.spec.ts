import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// «Создать пациента» above the doctor's list and the new-patient draft (owner 2026-11-05): what is
// typed on «Новый пациент» becomes a card at the top of the list, the card opens the form where it
// was left, also after a reload, and the card goes once the patient is created or discarded.

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-draft-'));
  const port = 8_960 + test.info().workerIndex;
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

/** The drafts this device keeps, opened with the device key the page itself holds. */
function keptDrafts(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('minimed-diary-doctor', 1);
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    const read = (key: string): Promise<unknown> =>
      new Promise((done, fail) => {
        const request = db.transaction('keys').objectStore('keys').get(key);
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
    const all = await new Promise<IDBValidKey[]>((done, fail) => {
      const request = db.transaction('keys').objectStore('keys').getAllKeys();
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    const slot = all.find((key) => String(key).startsWith('new-patients:'));
    const key = (await read('device')) as CryptoKey | undefined;
    const copy = slot
      ? ((await read(String(slot))) as { iv: Uint8Array; data: ArrayBuffer })
      : undefined;
    if (!copy || !key) return '';
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: copy.iv as Uint8Array<ArrayBuffer> },
      key,
      copy.data,
    );
    return new TextDecoder().decode(plain);
  });
}

test('a new patient begun is a draft card: leave, reload, continue from the card, create', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByLabel('Почта', { exact: true }).fill('draft@example.test');
  await page.getByLabel('Как вас подписать для пациентов').fill('Д-р Петрова');
  await page.getByLabel('Новый пароль (от 8 символов)').fill('draft-pass-2026');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: 'Я сохранил(а) код' }).click({ timeout: 60_000 });

  const create = page.getByTestId('diary-create-patient');
  const cards = page.getByTestId('diary-new-draft');
  await expect(create).toBeVisible({ timeout: 60_000 });
  await expect(create).toHaveText('Создать пациента');

  // An empty form left untouched leaves nothing behind.
  await create.click();
  await expect(page.getByLabel('Имя или псевдоним')).toBeVisible();
  await expect(page).toHaveURL(/#\/notes\/diaries\/new$/u);
  await page.getByRole('button', { name: 'К списку' }).click();
  await expect(create).toBeVisible();
  await expect(cards).toHaveCount(0);

  // The first change makes the form a draft: the address names it.
  await create.click();
  await page.getByLabel('Имя или псевдоним').fill('Ёжик');
  await expect(page).toHaveURL(/#\/notes\/diaries\/new\/[a-z0-9]{8,32}$/u);
  const draftUrl = page.url();
  // The instruction is a line of the patient's screen, written in place after a tap.
  await page.getByRole('button', { name: 'Инструкция пациенту' }).click();
  await page.getByLabel('Инструкция пациенту').fill('Давление утром и вечером');
  await page.getByRole('button', { name: 'К списку' }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Ёжик');
  await expect(cards.first()).toContainText('Черновик');
  await page.screenshot({ path: testInfo.outputPath('draft-card.png') });

  // The draft is on the device, sealed, and a reload finds the card again.
  await expect.poll(() => keptDrafts(page)).toContain('Давление утром и вечером');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(cards).toHaveCount(1, { timeout: 60_000 });
  await expect(create).toBeVisible();

  // The card opens the form where it was left.
  await page.getByRole('button', { name: 'Продолжить: Ёжик' }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByLabel('Имя или псевдоним')).toHaveValue('Ёжик');
  await expect(page.locator('.screen-editor__note')).toHaveText('Давление утром и вечером');

  // A reload on the form itself keeps it too.
  await page.getByLabel('Имя или псевдоним').fill('Ёжик Колючий');
  await expect.poll(() => keptDrafts(page)).toContain('Ёжик Колючий');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Имя или псевдоним')).toHaveValue('Ёжик Колючий', {
    timeout: 60_000,
  });
  await expect(page.locator('.screen-editor__note')).toHaveText('Давление утром и вечером');

  // Created: the draft is gone, the patient is in the list, and the button stays above it.
  await page.getByRole('button', { name: 'Добавить пациента' }).click();
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Готово' }).first().click();
  await page.getByRole('button', { name: 'К списку' }).click();
  await expect(page.locator('.diary-dash-row')).toHaveCount(1);
  await expect(page.locator('.diary-dash-row').first()).toContainText('Ёжик Колючий');
  await expect(cards).toHaveCount(0);
  await expect(create).toBeVisible();
  await expect.poll(() => keptDrafts(page)).not.toContain('Ёжик');
  await page.screenshot({ path: testInfo.outputPath('list-after-create.png') });

  // Another draft, let go from its card: gone, also after a reload.
  await create.click();
  await page.getByLabel('Имя или псевдоним').fill('Сова');
  await page.getByRole('button', { name: 'К списку' }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Удалить черновик: Сова' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(cards).toHaveCount(0);
  await expect.poll(() => keptDrafts(page)).not.toContain('Сова');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.diary-dash-row')).toHaveCount(1, { timeout: 60_000 });
  await expect(cards).toHaveCount(0);
});
