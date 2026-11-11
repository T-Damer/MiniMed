import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type BrowserContext, expect, type Page, test } from '@playwright/test';

import { testInvitation, testInvitationLink } from './diary-fixtures';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// DIARY26 (owner 2026-11-04): before the diary starts the patient reads and accepts, each on its
// own, the informed consent to remote follow-up, the personal-data consent and the remote-care
// contract. The clinic and doctor come from the doctor's «Врач и организация»; the acceptances
// (wording, time) travel with the encrypted consent record, and the doctor's page shows them.

const TITLES = [
  'Информированное согласие на дистанционное наблюдение',
  'Согласие на обработку персональных данных',
  'Договор на дистанционное сопровождение',
];

const OPERATOR = {
  organization: 'ООО «Клиника Тест»',
  address: 'Воронеж, ул. Мира, 1',
  ogrn: '1027700132195',
  clinician: 'Иванова Анна Петровна',
  position: 'врач-психиатр',
};

const documentCard = (page: Page, title: string) =>
  page.locator('.consent-doc').filter({ has: page.getByRole('heading', { name: title }) });

/** Reads, accepts each document on its own, and starts the diary. */
async function acceptDocuments(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Документы для подключения' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Далее' });
  for (const [index, title] of TITLES.entries()) {
    await expect(next).toBeDisabled();
    await documentCard(page, title)
      .getByRole('button', { name: `Принимаю: ${title}` })
      .click();
    await expect(page.locator('.consent-docs__count')).toHaveText(
      index === TITLES.length - 1
        ? 'Все документы приняты'
        : `Принято ${index + 1} из 3 документов`,
    );
  }
  await next.click();
  await expect(page.getByRole('heading', { name: 'Если станет очень плохо' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать дневник' }).click();
}

test.describe('joining documents on a diary link', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('three documents, each accepted on its own, with the clinic in the full text', async ({
    page,
  }, testInfo) => {
    const invitation = testInvitation({
      id: 'consentlink01',
      template: 'care',
      doctor: 'Д-р Иванова',
      plan: [{ id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '08:00' }] }],
      consent: { operator: OPERATOR },
    });
    await page.goto(await testInvitationLink(invitation));

    await expect(page.getByRole('heading', { name: 'Документы для подключения' })).toBeVisible();
    await expect(page.locator('.consent-doc')).toHaveCount(3);
    for (const title of TITLES) {
      await expect(documentCard(page, title).locator('.consent-doc__badge')).toHaveText('Шаблон');
    }
    // Nothing of the diary is reachable before the documents: no tabs, no marks.
    await expect(page.getByRole('navigation', { name: 'Дневник' })).toHaveCount(0);
    await expect(page.locator('.care-row')).toHaveCount(0);

    // The full text unfolds in place, with the clinic and the doctor filled in.
    const contract = documentCard(page, TITLES[2] as string);
    const full = contract.locator('.consent-full');
    await expect(full).not.toHaveClass(/consent-full--open/u);
    await contract.getByRole('button', { name: 'Полный текст' }).click();
    await expect(full).toHaveClass(/consent-full--open/u);
    await expect(full).toContainText(
      'ООО «Клиника Тест», Воронеж, ул. Мира, 1, ОГРН 1027700132195',
    );
    await expect(full).toContainText('Иванова Анна Петровна');
    // What only the clinic can set stays a visible blank of the template.
    await expect(full.locator('.consent-text__blank')).toContainText([
      'стоимость и порядок оплаты',
    ]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath('documents.png'), fullPage: true });

    // A tap takes an acceptance back.
    const first = documentCard(page, TITLES[0] as string).getByRole('button', {
      name: `Принимаю: ${TITLES[0]}`,
    });
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');

    await acceptDocuments(page);
    await expect(page.locator('.care-row').filter({ hasText: 'Сертралин' })).toBeVisible();

    // Each document is kept with its wording and time; the diary starts at the last one.
    const meta = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('minimed.diary.meta.v1.consentlink01') ?? '{}'),
    );
    expect(meta.consents.map((item: { document: string }) => item.document)).toEqual([
      'monitoring',
      'personal-data',
      'contract',
    ]);
    for (const item of meta.consents) expect(item.version).toMatch(/^template-/u);
    expect(meta.consentAt).toBe(
      meta.consents
        .map((item: { at: string }) => item.at)
        .sort()
        .at(-1),
    );

    // Accepted once: the diary opens straight away next time, and the texts stay in «Ещё».
    await page.reload();
    await expect(page.locator('.care-row').filter({ hasText: 'Сертралин' })).toBeVisible();
    await expect(page.locator('.consent-doc')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Дневник' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    await page.getByRole('button', { name: 'Принятые документы' }).click();
    const record = page.getByTestId('consent-record');
    await expect(record.locator('.consent-record__item')).toHaveCount(3);
    await expect(record.locator('.consent-record__when')).toHaveText([
      /^Принят .* · шаблон от \d\d\.\d\d\.\d{4}$/u,
      /^Принят /u,
      /^Принят /u,
    ]);
  });
});

test.describe('joining documents on a connected diary', () => {
  const ROOT = resolve(import.meta.dirname, '../../..');
  let server: ChildProcess | undefined;
  let directory = '';
  let service = '';

  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minimed-diary-consent-'));
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

  /** The app talks to its own origin: send those calls to the scratch service. */
  async function useService(context: BrowserContext): Promise<void> {
    await context.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
      route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
    );
  }

  test('nothing reaches the doctor before the documents; then the doctor sees them and when', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const doctorContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await useService(doctorContext);
    await doctorContext.addInitScript(
      (profile) => {
        window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
        window.localStorage.setItem('minimed.clinician-profile.v1', JSON.stringify(profile));
      },
      {
        organizationName: OPERATOR.organization,
        organizationAddress: OPERATOR.address,
        ogrn: OPERATOR.ogrn,
        clinicianFullName: OPERATOR.clinician,
        clinicianPosition: OPERATOR.position,
      },
    );
    const doctor = await doctorContext.newPage();
    await doctor.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
      waitUntil: 'domcontentloaded',
    });

    // A doctor signs up on the scratch service and adds a patient.
    await doctor.getByText('Регистрация', { exact: true }).click();
    await doctor.getByLabel('Почта', { exact: true }).fill('consent@example.test');
    await doctor.getByLabel('Как вас подписать для пациентов').fill('Д-р Иванова');
    await doctor.getByLabel('Новый пароль (от 8 символов)').fill('consent-pass-2026');
    await doctor.getByRole('checkbox', { name: /Согласен\(на\)/u }).check();
    await doctor.getByRole('button', { name: 'Создать аккаунт' }).click();
    await doctor.getByRole('button', { name: 'Я сохранил(а) код' }).click({ timeout: 60_000 });
    await expect(doctor.getByRole('heading', { name: /Сигнум/u })).toBeVisible();
    await doctor.getByRole('button', { name: 'Новый пациент' }).first().click();
    await doctor.getByLabel('Имя или псевдоним').fill('Лиса');
    await doctor.getByRole('button', { name: 'Добавить пациента' }).click();
    const copy = doctor.getByRole('button', { name: 'Копировать ссылку' });
    await expect(copy).toBeEnabled({ timeout: 60_000 });
    await copy.click();
    const link = await doctor.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/#c=/u);

    // The patient's phone pairs and shows the documents with the doctor's clinic.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await useService(phone);
    const patient = await phone.newPage();
    const pushes: string[] = [];
    patient.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/patients\/[^/]+\/records$/u.test(new URL(request.url()).pathname)
      ) {
        pushes.push(request.url());
      }
    });
    await patient.goto(link);
    await expect(patient.getByRole('heading', { name: 'Документы для подключения' })).toBeVisible({
      timeout: 60_000,
    });
    const contract = documentCard(patient, TITLES[2] as string);
    await contract.getByRole('button', { name: 'Полный текст' }).click();
    await expect(contract.locator('.consent-full')).toContainText(OPERATOR.organization);
    await expect(contract.locator('.consent-full')).toContainText(OPERATOR.clinician);
    await patient.screenshot({ path: testInfo.outputPath('connected-documents.png') });

    // Paired, not yet accepted: the doctor waits, and nothing was sent from the phone.
    await doctor.getByRole('button', { name: 'Готово' }).click();
    await doctor.getByText('Лиса').first().click();
    await expect(doctor.getByTestId('patient-consent')).toHaveText('Документы ещё не приняты', {
      timeout: 60_000,
    });
    expect(pushes).toEqual([]);

    await acceptDocuments(patient);
    await expect(patient.locator('.diary-today')).toBeVisible();

    // The consent record arrives: the doctor sees the three documents and when.
    const chip = doctor.getByTestId('patient-consent');
    await expect(async () => {
      if (!(await chip.textContent())?.startsWith('Документы приняты')) {
        await doctor.reload({ waitUntil: 'domcontentloaded' });
      }
      await expect(chip).toHaveText(/^Документы приняты /u, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await chip.click();
    const record = doctor.getByTestId('consent-record');
    await expect(record.locator('.consent-record__title')).toHaveText(TITLES);
    await expect(record.locator('.consent-record__when')).toHaveText([
      /^Принят .* · шаблон от /u,
      /^Принят .* · шаблон от /u,
      /^Принят .* · шаблон от /u,
    ]);
    await doctor.waitForTimeout(300);
    await doctor.screenshot({ path: testInfo.outputPath('doctor-documents.png') });

    await phone.close();
    await doctorContext.close();
  });
});
