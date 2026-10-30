import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctor's sign-in to the connected diary (owner 2026-10-30): signed out it is the whole
// screen, and a sign-up code alone signs a no-name doctor in. The service is faked here; the keys
// are derived, sealed and opened by the app's real code.

const ISSUED_CODE = 'K2CM-R5AG-2M4R';
const SALT = 'c2lnbmluLXNwZWMtc2FsdA';

interface Account {
  readonly email: string;
  readonly name: string;
  readonly authKey: string;
  readonly kdf: { readonly salt: string; readonly iterations: number };
  readonly identity: unknown;
  readonly identityBlob: string;
}

/** The diary service as the sign-in sees it, with sign-up by invite (apps/diary-server). */
async function fakeDiaryService(page: Page) {
  const accounts = new Map<string, Account>();
  const used = new Set<string>();
  const calls: string[] = [];
  const profile = (account: Account) => ({
    id: 'doctor0000001',
    email: account.email,
    name: account.name,
    identity: account.identity,
  });
  await page.route(`${E2E_ASSET_ORIGIN}/api/events**`, (route) => route.abort());
  await page.route(`${E2E_ASSET_ORIGIN}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const reply = (status: number, json: unknown) => route.fulfill({ status, json });
    calls.push(path);
    switch (path) {
      case '/api/info':
        return reply(200, { signup: 'invite' });
      case '/api/auth/prelogin': {
        const account = accounts.get(String(body['email']));
        return reply(200, { kdf: account?.kdf ?? { salt: SALT, iterations: 100_000 } });
      }
      case '/api/auth/register': {
        const invite = String(body['invite'] ?? '')
          .toUpperCase()
          .replaceAll(/[^A-Z0-9]/gu, '')
          .replaceAll(/(.{4})(?=.)/gu, '$1-');
        if (invite !== ISSUED_CODE || used.has(invite)) {
          return reply(403, { error: 'Код приглашения не подошёл или уже использован.' });
        }
        used.add(invite);
        const account = body as unknown as Account;
        accounts.set(account.email, account);
        return reply(201, {
          token: 'token0000001',
          doctor: profile(account),
          identityBlob: account.identityBlob,
        });
      }
      case '/api/auth/login': {
        const account = accounts.get(String(body['email']));
        if (!account || account.authKey !== body['authKey']) {
          return reply(401, { error: 'Неверный адрес или пароль.' });
        }
        return reply(200, {
          token: 'token0000002',
          doctor: profile(account),
          identityBlob: account.identityBlob,
        });
      }
      case '/api/patients':
        return reply(200, { patients: [] });
      case '/api/alerts':
        return reply(200, { alerts: [] });
      default:
        return reply(200, { ok: true });
    }
  });
  return { accounts, calls };
}

async function openSignedOut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'С возвращением!' })).toBeVisible();
}

const tabBar = (page: Page) => page.locator('nav[aria-label="Разделы приложения"]');
const codeField = (page: Page) => page.getByLabel('Почта или код доступа');
const passwordRow = (page: Page) =>
  page.locator('.diary-signin__reveal').filter({ has: page.locator('input[type="password"]') });

test.describe('diary sign-in', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('signed out, the sign-in is the whole screen and switches modes in place', async ({
    page,
  }) => {
    await fakeDiaryService(page);
    await openSignedOut(page);

    // No route header (its «?» and title), no bottom bar: only the form.
    await expect(tabBar(page)).toHaveCount(0);
    await expect(page.locator('.diary-dash__header')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Как это работает' })).toHaveCount(0);
    const submit = page.getByRole('button', { name: 'Войти', exact: true });
    await expect(submit).toBeInViewport({ ratio: 1 });
    // Nothing scrolls on a phone: the card fits.
    expect(
      await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0),
    ).toBeLessThanOrEqual(812);

    // «Регистрация» changes the same form: nothing re-mounts, the old headline only fades.
    const form = await page.locator('.diary-signin__form').elementHandle();
    await page.getByText('Регистрация', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Добро пожаловать!' })).toBeVisible();
    await expect(page.getByLabel('Как вас подписать для пациентов')).toBeVisible();
    expect(await form?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.getByRole('heading', { name: 'С возвращением!' })).toBeHidden();

    await page.getByText('Вход', { exact: true }).click();
    await expect(page.getByLabel('Как вас подписать для пациентов')).toBeHidden();
    expect(await form?.evaluate((element) => element.isConnected)).toBe(true);
  });

  test('an access code alone signs a no-name doctor in, and again later', async ({ page }) => {
    const service = await fakeDiaryService(page);
    await openSignedOut(page);

    // Typed in full, the code folds the password away.
    await expect(passwordRow(page)).toBeVisible();
    await codeField(page).fill('k2cm r5ag 2m4r');
    await expect(passwordRow(page)).toBeHidden();
    await page.getByRole('button', { name: 'Войти по коду' }).click();

    await expect(page.getByRole('heading', { name: 'Дневники пациентов' })).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    // The first use spent the code on sign-up: no e-mail and no name were asked for.
    const [account] = [...service.accounts.values()];
    expect(account?.email).toMatch(/^[0-9a-f]{20}@code\.invalid$/u);
    expect(account?.email).not.toContain('k2cm');
    expect(account?.name).toBe('Врач');

    // Signed out on this device, the same code opens the same account.
    await page.evaluate(() => window.localStorage.removeItem('minimed.diary.doctor.v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await codeField(page).fill(ISSUED_CODE);
    await page.getByRole('button', { name: 'Войти по коду' }).click();
    await expect(page.getByRole('heading', { name: 'Дневники пациентов' })).toBeVisible();
    expect(service.calls.filter((path) => path === '/api/auth/register')).toHaveLength(1);
    expect(service.accounts.size).toBe(1);
  });

  test('a code the service did not issue is refused', async ({ page }) => {
    const service = await fakeDiaryService(page);
    await openSignedOut(page);
    await codeField(page).fill('AAAA-BBBB-CCCC');
    await page.getByRole('button', { name: 'Войти по коду' }).click();
    await expect(page.getByRole('alert')).toHaveText('Код не подошёл.');
    expect(service.accounts.size).toBe(0);
    await expect(tabBar(page)).toHaveCount(0);
  });
});
