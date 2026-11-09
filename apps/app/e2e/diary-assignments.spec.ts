import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import {
  careInvitation,
  emptyCareDraft,
  newCareAssignment,
} from '../src/features/diary/diary-care-draft';
import { parseDiaryInvitation } from '../src/features/diary/diary-model';
import { builtInWorksheetsFrom } from '../src/features/worksheets/built-in-worksheets';
import seed from '../src/features/worksheets/cbt-worksheets.ru.json' with { type: 'json' };
import { testInvitationLink } from './diary-fixtures';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// CBT1 stage 2–3: a worksheet the doctor assigned, filled on the patient's phone with the voice
// kept on that phone, and the doctor's page of what the patient wrote.

test.use({ viewport: { width: 390, height: 844 } });

/** Evidence for a review: `E2E_SHOTS=<dir>` saves the pages as PNG. */
async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SHOTS'];
  if (directory) await page.waitForTimeout(700);
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

function thoughtRecordDiary() {
  const worksheet = builtInWorksheetsFrom(seed).find((one) => one.id === 'cbt-thought-record');
  if (!worksheet) throw new Error('cbt-thought-record');
  const today = new Date().toISOString().slice(0, 10);
  const issued = careInvitation({
    id: 'cbtdiary0001',
    draft: {
      ...emptyCareDraft(),
      assignments: [
        {
          ...newCareAssignment(worksheet, today),
          why: 'Чтобы увидеть, какие мысли поднимают тревогу',
        },
      ],
    },
    doctor: 'Иванова А. А.',
    note: '',
  });
  // Without the joining documents: this test is about the worksheet.
  const { consent: _consent, ...plan } = issued;
  return parseDiaryInvitation({
    ...plan,
    issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
}

test('the patient fills an assigned worksheet; a recording stays on the phone', async ({
  page,
}) => {
  // A tone stands in for the microphone; no speech model is on this «phone».
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const tone = context.createOscillator();
      const sink = context.createMediaStreamDestination();
      tone.connect(sink);
      tone.start();
      return sink.stream;
    };
  });
  const outgoing: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('huggingface.co') || request.method() === 'POST') {
      outgoing.push(request.url());
    }
  });
  await page.goto(await testInvitationLink(thoughtRecordDiary()));

  await expect(page.getByRole('heading', { name: 'Задания' })).toBeVisible();
  const row = page.locator('.care-row').filter({ hasText: 'Запись мыслей' });
  await expect(row).toContainText('Когда случится');
  await shot(page, 'patient-today');
  await row.getByRole('button', { name: 'Запись мыслей: заполнить' }).click();

  const sheet = page.getByRole('dialog', { name: 'Запись мыслей' });
  await expect(sheet.getByText('Чтобы увидеть, какие мысли поднимают тревогу')).toBeVisible();
  await expect(sheet.getByText(/запись остаётся на телефоне/u)).toBeVisible();
  // The basic version: three columns and the strength, no «Доводы против».
  const labels = sheet.locator('.worksheet-fill__label');
  await expect(labels.filter({ hasText: /^Автоматическая мысль$/u })).toBeVisible();
  await expect(labels.filter({ hasText: /^Доводы против$/u })).toHaveCount(0);
  // A field's «?» opens its plain explanation.
  await sheet.getByRole('button', { name: 'Что значит «Ситуация»' }).click();
  await expect(sheet.locator('.worksheet-fill__hint').first()).toBeVisible();
  await shot(page, 'patient-sheet');

  // Dictating: the recording is kept on this phone; without the model nothing is sent anywhere.
  await sheet.getByRole('button', { name: 'Сказать голосом: Ситуация' }).click();
  await expect(sheet.getByRole('status').filter({ hasText: 'Говорите' })).toBeVisible();
  await page.waitForTimeout(1200);
  await sheet.getByRole('button', { name: 'Остановить запись' }).click();
  await sheet.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(sheet.getByText(/Запись осталась на телефоне/u)).toBeVisible();
  const clips = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('minimed-diary-voices');
        open.onsuccess = () => {
          const count = open.result.transaction('clips').objectStore('clips').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
  expect(clips).toBe(1);

  await sheet.getByLabel('Ситуация', { exact: true }).fill('Начальник попросил зайти');
  await sheet.getByLabel('Эмоция', { exact: true }).fill('тревога');
  await sheet.getByLabel('Сила эмоции, от 0 до 100').fill('70');
  await sheet.getByLabel('Автоматическая мысль', { exact: true }).fill('Меня уволят');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText('1 запись');
  await expect(page.locator('.care-note')).toContainText('Начальник попросил зайти');
  await shot(page, 'patient-today-filled');

  // The entry opens again with what was written.
  await page.locator('.care-note').filter({ hasText: 'Начальник попросил зайти' }).click();
  await expect(sheet.getByLabel('Автоматическая мысль', { exact: true })).toHaveValue(
    'Меня уволят',
  );
  expect(outgoing).toEqual([]);
});

const ROOT = resolve(import.meta.dirname, '../../..');
let server: ChildProcess | undefined;
let directory = '';
let service = '';

test.describe('the doctor', () => {
  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minimed-diary-tasks-'));
    const port = 8_950 + test.info().workerIndex;
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

  test('reads the patient’s worksheet rows with the dictated texts marked, and adds a task', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
      route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
    );
    await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
    await expect(page.locator('.diary-dash-row')).toHaveCount(4, { timeout: 120_000 });
    await page.locator('.diary-dash-row').filter({ hasText: 'Лиса' }).click();

    const tasks = page.getByRole('region', { name: 'Задания' });
    await expect(tasks).toContainText('Запись мыслей');
    await expect(tasks).toContainText('4 записи');
    await tasks.getByRole('button', { name: /Запись мыслей/u }).click();
    await expect(page).toHaveURL(/\/task\/w1$/u);
    await expect(page.getByRole('heading', { name: 'Запись мыслей' })).toBeVisible();
    await expect(page.getByText('Сила эмоции и эмоция после')).toBeVisible();
    const rows = page.getByRole('list', { name: 'Записи пациента' }).getByRole('listitem');
    await expect(rows).toHaveCount(4);
    await expect(page.getByText(/голосом, 0:09 · распознано на телефоне/u)).toContainText(
      'текст исправлен',
    );
    await shot(page, 'doctor-task');

    // «Редактировать» → «+ Задание»: a sheet from the library, set up for this patient.
    await page.getByRole('button', { name: 'К пациенту' }).first().click();
    await page.getByRole('button', { name: 'Редактировать' }).first().click();
    await page.getByRole('button', { name: 'Задание', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Дневники и задания' });
    await picker.getByRole('button', { name: /Дневник активности и настроения/u }).click();
    const assign = page.getByRole('dialog', { name: /Дневник активности и настроения/u });
    await assign.getByText('По дням', { exact: true }).click();
    await expect(assign.getByRole('button', { name: 'Пн' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await assign
      .getByLabel('Зачем это вам — для пациента')
      .fill('Чтобы увидеть, что поднимает настроение');
    await shot(page, 'doctor-assign');
    await assign.getByRole('button', { name: 'Готово' }).click();
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('region', { name: 'Задания' })).toContainText(
      'Дневник активности и настроения',
    );
  });
});
