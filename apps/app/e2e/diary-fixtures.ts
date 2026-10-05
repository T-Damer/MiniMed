import { expect, type Page } from '@playwright/test';
import { diaryInvitationLink } from '../src/features/diary/diary-codec';
import {
  createDiaryId,
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  diaryTemplate,
  parseDiaryInvitation,
} from '../src/features/diary/diary-model';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

export const DIARY_PAGE = `${E2E_ASSET_ORIGIN}/diary/`;

export interface TestInvitationOptions {
  readonly id?: string;
  readonly template?: string;
  readonly issuedAt?: string;
  readonly doctor?: string;
  readonly note?: string;
  readonly plan?: readonly { id: string; name: string; dose?: string; schedule?: string }[];
}

/** A built-in-template invitation exactly as the doctor's dialog would issue it. */
export function testInvitation(options: TestInvitationOptions = {}): DiaryInvitation {
  const template = diaryTemplate(options.template ?? 'blood-pressure');
  if (!template) throw new Error('Unknown template.');
  return parseDiaryInvitation({
    v: DIARY_FORMAT_VERSION,
    id: options.id ?? createDiaryId(),
    template: template.id,
    title: template.title,
    issuedAt: options.issuedAt ?? new Date(Date.now() - 3_600_000).toISOString(),
    fields: template.fields,
    ...(options.plan
      ? { plan: options.plan, planTitle: template.planTitle ?? 'Назначение врача' }
      : {}),
    ...(options.doctor ? { doctor: options.doctor } : {}),
    ...(options.note ? { note: options.note } : {}),
  });
}

export function testInvitationLink(
  invitation: DiaryInvitation,
  page = DIARY_PAGE,
): Promise<string> {
  return diaryInvitationLink(invitation, page);
}

/** `YYYY-MM-DDTHH:mm` in local time, `daysAgo` days before now, as a datetime-local input wants it. */
export function localInput(daysAgo: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface BloodPressure {
  readonly systolic: number;
  readonly diastolic: number;
  readonly pulse?: number;
  readonly at?: string;
}

/** Fills the patient's entry form for a blood-pressure diary and saves it. */
export async function addReading(page: Page, reading: BloodPressure): Promise<void> {
  await page.getByLabel(/^Верхнее/u).fill(String(reading.systolic));
  await page.getByLabel(/^Нижнее/u).fill(String(reading.diastolic));
  if (reading.pulse !== undefined) await page.getByLabel(/^Пульс/u).fill(String(reading.pulse));
  if (reading.at) await page.getByLabel('Дата и время').fill(reading.at);
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.diary-saved')).toBeVisible();
}

export const ENTRY_ROWS = '.diary-entries__item';

/** True when the diary page is the built one (service worker active), false on the dev server. */
export async function isBuiltDiary(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector('script[src*="/src/"]') === null);
}

export const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** A messenger's built-in web view on iOS: no «Version/… Safari/…» tail. */
export const IPHONE_MESSENGER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
export const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/** Hands the diary to the doctor as a file and returns the text of that file. */
export async function patientFileText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Передать врачу', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Отправить файлом' }).click();
  const path = await (await download).path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  await page.getByRole('button', { name: 'Врач получил' }).click();
  await page.getByRole('button', { name: 'Назад к дневнику' }).click();
  return text;
}

/** Opens the patients area of the doctor's app and creates a card. */
export async function createDoctorCard(page: Page, name: string, first: boolean): Promise<void> {
  if (first) {
    await page.getByRole('button', { name: 'Заметки', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
    await page.getByRole('button', { name: /^(Понятно, продолжить|Открыть)$/u }).click();
  } else {
    await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
    await page.getByRole('button', { name: 'Новый пациент', exact: true }).click();
  }
  await page.getByLabel('Имя или псевдоним').fill(name);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
