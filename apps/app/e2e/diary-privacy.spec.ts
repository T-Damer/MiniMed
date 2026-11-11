import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's privacy policy (152-ФЗ ст. 9, 18.1): an unticked consent box at sign-up with the
// policy one tap away, an account the server refuses without the consent, the entry in «⋯», and
// the dialog an older account meets after signing in. Against a scratch diary server.

const ROOT = resolve(import.meta.dirname, '../../..');
const SHOTS = process.env['PRIVACY_SHOTS'];
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'minimed-diary-privacy-'));
  const port = 9_080 + test.info().workerIndex;
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
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(() => {
  server?.kill();
  rmSync(directory, { recursive: true, force: true });
});

const consentBox = (page: Page) => page.getByRole('checkbox', { name: /Согласен\(на\)/u });

async function openRegistration(page: Page): Promise<void> {
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
}

async function shot(page: Page, name: string): Promise<void> {
  // Let the folding fields and the sheet finish moving before the picture.
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

for (const size of SIZES) {
  test(`sign-up asks for the consent, with the policy in a sheet (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openRegistration(page);
    await page.getByLabel('Почта', { exact: true }).fill(`privacy-${size.name}@example.test`);
    await page.getByLabel('Как вас подписать для пациентов').fill('Д-р Новикова');
    await page.getByLabel('Новый пароль (от 8 символов)').fill('privacy-pass-2026');

    // A separate, unticked box; the account button stays off until it is ticked.
    await expect(consentBox(page)).toBeVisible();
    await expect(consentBox(page)).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled();
    await shot(page, `signup-${size.name}`);

    // The link inside the label opens the policy and does not tick the box.
    await page.getByRole('button', { name: 'Политике' }).click();
    const policy = page.getByTestId('service-privacy');
    await expect(policy).toContainText('Владелец сервиса med.1damer.com');
    await expect(policy).toContainText('admin@1damer.com');
    await expect(policy).toContainText('ru-central1');
    await expect(consentBox(page)).not.toBeChecked();
    await shot(page, `policy-${size.name}`);
    await page.keyboard.press('Escape');
    await expect(policy).toBeHidden();

    await consentBox(page).check();
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeEnabled();
  });
}

test('the server keeps the accepted version; an older account is asked again after signing in', async ({
  page,
}) => {
  await openRegistration(page);
  await page.getByLabel('Почта', { exact: true }).fill('privacy-old@example.test');
  await page.getByLabel('Как вас подписать для пациентов').fill('Д-р Старова');
  await page.getByLabel('Новый пароль (от 8 символов)').fill('privacy-pass-2026');
  await consentBox(page).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: 'Я сохранил(а) код' }).click({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /Сигнум/u })).toBeVisible();

  // The current wording was accepted at registration: nothing is asked.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // «⋯» opens the policy any time.
  await page
    .getByRole('button', { name: /Ещё|Меню|⋯/u })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Политика обработки данных' }).click();
  await expect(page.getByTestId('service-privacy')).toBeVisible();
  await page.keyboard.press('Escape');

  // An account whose accepted version is older (the policy was reworded since): the dialog.
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('minimed.diary.doctor.v1');
    return (JSON.parse(raw ?? '{}') as { token?: string }).token ?? '';
  });
  expect(token).not.toBe('');
  const older = await fetch(`${service}/api/auth/privacy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ version: 'service-privacy-2020-01-01' }),
  });
  expect(older.status).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const gate = page.getByRole('alertdialog');
  await expect(gate).toContainText('Политика обработки данных');
  await shot(page, 'accept-dialog');
  // It cannot be dismissed with Escape.
  await page.keyboard.press('Escape');
  await expect(gate).toBeVisible();

  await gate.getByRole('button', { name: 'Принимаю' }).click();
  await expect(gate).toBeHidden();
  const me = await fetch(`${service}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await me.json()) as { privacy: { version: string } | null };
  expect(body.privacy?.version).toMatch(/^service-privacy-/u);
  expect(body.privacy?.version).not.toBe('service-privacy-2020-01-01');
});
