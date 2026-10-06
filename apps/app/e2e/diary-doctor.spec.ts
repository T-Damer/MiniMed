import { expect, type Page, test } from '@playwright/test';

import {
  addReading,
  backToHome,
  createDoctorCard,
  ENTRY_ROWS,
  expectRecordCount,
  localInput,
  openRecords,
  patientFileText,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';
import { mountBuiltApp } from './mount-built-app';

const ISSUED = '[aria-label="Выданные дневники"]';
const DIARY_EVENTS = (page: Page) =>
  page.locator('.patient-workspace__event').filter({ hasText: 'дневник пациента' });

async function noCanShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
}

async function issueBloodPressureDiary(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Выдать дневник', exact: true }).click();
  await page.getByLabel('Врач (необязательно)').fill('Иванова А. А.');
  await page.getByRole('button', { name: 'Создать QR-код', exact: true }).click();
  const link = await page.locator('.patient-diary__link').getAttribute('href');
  expect(link).toContain('#i=');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  return link ?? '';
}

async function importText(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Принять данные', exact: true }).click();
  await page.getByText('Пациент прислал файл или текст').click();
  await page.getByLabel('Или вставьте текст из сообщения').fill(text);
  await page.getByRole('button', { name: 'Прочитать текст', exact: true }).click();
}

test.describe('diary: doctor and patient round trip', () => {
  test('issue, fill in, return, re-import, correct, update: nothing is lost or duplicated', async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    await createDoctorCard(page, 'Пациент дневника', true);

    // 1. The doctor issues a diary; the card remembers it.
    const link = await issueBloodPressureDiary(page);
    const issued = page.locator(ISSUED);
    await expect(issued).toContainText('Дневник артериального давления');
    await expect(issued).toContainText('Данных от пациента ещё не получали');

    // 2. The patient opens it on a phone and enters readings over several days.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined });
    });
    const patient = await phone.newPage();
    await patient.goto(link);
    await addReading(patient, {
      systolic: 150,
      diastolic: 95,
      pulse: 80,
      at: localInput(2, 8, 10),
    });
    await addReading(patient, { systolic: 142, diastolic: 90, at: localInput(1, 8, 5) });
    await addReading(patient, { systolic: 135, diastolic: 85, at: localInput(0, 7, 55) });
    const firstFile = await patientFileText(patient);

    // 3. The doctor imports the file.
    await importText(page, firstFile);
    await expect(
      page.locator('.patient-diary__hint', { hasText: 'новых записей 3' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить в карту', exact: true }).click();
    await expect(DIARY_EVENTS(page)).toHaveCount(3);
    await expect(issued).toContainText('записей 3');

    // 4. Importing the same file again changes nothing.
    await importText(page, firstFile);
    await expect(page.locator('.patient-diary__hint', { hasText: 'уже есть 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить в карту', exact: true }).click();
    await expect(DIARY_EVENTS(page)).toHaveCount(3);

    // 5. The patient corrects a typo and adds a newer reading; the doctor gets both, once.
    await openRecords(patient);
    await patient
      .locator(ENTRY_ROWS)
      .first()
      .getByRole('button', { name: /^Изменить/u })
      .click();
    await patient.getByLabel(/^Верхнее/u).fill('145');
    await patient.getByRole('button', { name: 'Сохранить изменения' }).click();
    await backToHome(patient);
    await addReading(patient, { systolic: 130, diastolic: 80, at: localInput(0, 18, 0) });
    const secondFile = await patientFileText(patient);
    await importText(page, secondFile);
    await expect(
      page.locator('.patient-diary__hint', { hasText: 'исправленных пациентом 1' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить в карту', exact: true }).click();
    await expect(DIARY_EVENTS(page)).toHaveCount(4);
    await expect(
      page.locator('.patient-workspace__event').filter({ hasText: 'Исправлено пациентом, ранее' }),
    ).toHaveCount(1);
    await importText(page, secondFile);
    await expect(page.locator('.patient-diary__hint', { hasText: 'уже есть 4' })).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(DIARY_EVENTS(page)).toHaveCount(4);

    // 6. The doctor shows the link again, then sends an updated version of the same diary.
    await page.getByRole('button', { name: 'Ссылка и QR', exact: true }).click();
    const again = await page.locator('.patient-diary__link').getAttribute('href');
    expect(again).toBe(link);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await page.getByLabel('Инструкция пациенту').fill('Теперь измеряйте только утром');
    await page.getByRole('button', { name: 'Получить новую ссылку', exact: true }).click();
    const updatedLink = await page.locator('.patient-diary__link').getAttribute('href');
    expect(updatedLink).not.toBe(link);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(issued).toContainText('обновлён');

    await patient.goto(updatedLink ?? '');
    await expect(patient.locator('.diary-notice')).toContainText('Врач обновил дневник');
    await expect(patient.locator('.diary-header__note')).toHaveText(
      'Теперь измеряйте только утром',
    );
    await expectRecordCount(patient, 4);
    // The very first link still opens the same diary and does not roll it back.
    await patient.goto(link);
    await expect(patient.locator('.diary-header__note')).toHaveText(
      'Теперь измеряйте только утром',
    );
    await patient.goto(link.split('#')[0] ?? '');
    await expectRecordCount(patient, 4);

    // 7. Results of this diary offered to another card are flagged before anything is saved.
    await createDoctorCard(page, 'Другой пациент', false);
    await importText(page, secondFile);
    await expect(page.locator('.patient-diary__warning')).toContainText('Пациент дневника');
    await expect(
      page.getByRole('button', { name: 'Сохранить в карту', exact: true }),
    ).toBeDisabled();
    await page.getByLabel('Всё равно сохранить в эту карточку').check();
    await expect(
      page.getByRole('button', { name: 'Сохранить в карту', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await phone.close();
  });

  test('a diary link the doctor never issued from this card is still accepted without a warning', async ({
    browser,
    page,
  }) => {
    await noCanShare(page);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    await createDoctorCard(page, 'Пациент с бумажным дневником', true);
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined });
    });
    const patient = await phone.newPage();
    await patient.goto(await testInvitationLink(testInvitation()));
    await addReading(patient, { systolic: 120, diastolic: 80, at: localInput(0, 8) });
    const file = await patientFileText(patient);
    await importText(page, file);
    await expect(page.locator('.patient-diary__warning')).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить в карту', exact: true }).click();
    await expect(DIARY_EVENTS(page)).toHaveCount(1);
    await phone.close();
  });
});
