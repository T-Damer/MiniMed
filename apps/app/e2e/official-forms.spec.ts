import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const SCREENS = resolve(import.meta.dirname, '../../../output/f1-screens');
const CAPTURE = process.env['F1_CAPTURE_SCREENS'] === '1';

/** Saves the current screen at 390 px in both colour schemes (F1_CAPTURE_SCREENS=1). */
async function capture(page: Page, name: string): Promise<void> {
  if (!CAPTURE) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENS}/${name}-${scheme}.png`, fullPage: false });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function openPatientVault(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await page.getByRole('button', { name: /^(Понятно, продолжить|Открыть)$/u }).click();
}

test('fills form 070/у from a patient card, shows the rule behind a field and previews the print', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });

  // 1. «Врач и организация» in Settings — device-local, filled into every form.
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Врач и организация' }).first()).toBeVisible();
  const orgName = page.getByLabel(
    'Наименование организации (или ФИО индивидуального предпринимателя)',
  );
  await orgName.fill('ГБУЗ «Городская поликлиника № 1»');
  await orgName.blur();
  await page.getByLabel('Адрес организации').fill('г. Москва, ул. Тестовая, д. 1');
  await page.getByLabel('ОГРН (ОГРНИП)').fill('1027700132195');
  await page.getByLabel('ФИО врача').fill('Петров Пётр Петрович');
  const position = page.getByLabel('Должность и специальность врача');
  await position.fill('врач-терапевт');
  await position.blur();
  await capture(page, 'settings-clinician');

  // 2. A patient with the data that forms need, kept in the patient vault.
  await openPatientVault(page);
  await page.getByLabel('Имя или псевдоним').fill('Пациент для справки');
  await page.getByLabel('Дата рождения').fill('1980-03-04');
  await page.getByLabel('Биологический пол').selectOption('male');
  await page.getByRole('button', { name: 'Создать карточку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пациент для справки' })).toBeVisible();

  await page.getByRole('button', { name: /Данные для справок и форм/u }).click();
  await page.getByLabel('ФИО полностью').fill('Иванов Иван Иванович');
  await page.getByLabel('СНИЛС').fill('123-456-789 01');
  await page.getByLabel('Номер полиса').fill('7700000000000001');
  await page.getByLabel('Страховая медицинская организация').fill('СМО «Тест»');
  await page.getByLabel('Субъект Российской Федерации').first().fill('г. Москва');
  await page.getByLabel('Населённый пункт').first().fill('Москва');
  await page.getByLabel('Улица').first().fill('Ленина');
  await page.getByLabel('Дом', { exact: true }).first().fill('5');
  await capture(page, 'patient-form-data');
  await page.getByRole('button', { name: 'Сохранить данные', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить данные', exact: true })).toBeDisabled();

  await page.getByPlaceholder('Краткая запись осмотра').fill('Осмотр перед направлением');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();
  await page.getByLabel('Диагноз осмотра').fill('Бронхиальная астма');
  await page.getByLabel('Код МКБ-10').fill('j45.0');
  await page.getByRole('button', { name: 'Сохранить диагноз', exact: true }).click();
  await expect(page.getByLabel('Код МКБ-10')).toHaveValue('J45.0');

  // 3. «Заполнить форму» from the patient card opens the list, then the form.
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();
  await capture(page, 'forms-list');
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/forms\/ru\.minzdrav\.274n\.070u\?patient=/u);

  const fullName = page.locator('#form-field-patientFullName');
  await expect(fullName.getByRole('textbox')).toHaveValue('Иванов Иван Иванович');
  await expect(fullName.getByText('подставлено', { exact: true })).toBeVisible();
  await expect(
    page.locator('#form-field-patientSex').getByRole('radio', { name: 'Муж.' }),
  ).toBeChecked();
  await expect(page.locator('#form-field-diagnosisIcd').getByRole('textbox')).toHaveValue('J45.0');
  await expect(page.locator('#form-field-organizationOgrn').getByRole('textbox')).toHaveValue(
    '1027700132195',
  );
  await expect(page.locator('#form-field-attendingDoctor').getByRole('textbox')).toHaveValue(
    'врач-терапевт Петров Пётр Петрович',
  );
  await expect(page.locator('#form-field-snils').getByRole('textbox')).toHaveValue(
    '123-456-789 01',
  );

  await page.locator('.forms-workspace__chrome').scrollIntoViewIfNeeded();
  await capture(page, 'form-070u-top');

  // Empty required fields are highlighted; the rule behind a field is one tap away.
  const preferredPlace = page.locator('#form-field-preferredPlace');
  await expect(preferredPlace).toHaveClass(/form-field--missing/u);
  await expect(page.locator('.forms-workspace__summary-item--missing')).toContainText(
    /Не заполнено \d+ обязательн/u,
  );
  await preferredPlace.getByRole('button', { name: 'Правило заполнения' }).click();
  await expect(preferredPlace.getByRole('note')).toContainText('6.12.');
  await expect(preferredPlace.getByRole('note')).toContainText('перечнем медицинских показаний');
  await expect(preferredPlace.getByRole('note')).toContainText(
    'приложение № 6 к приказу № 274н), п. 6.12',
  );
  await preferredPlace.scrollIntoViewIfNeeded();
  await capture(page, 'form-070u-rule');
  const formNumber = page.locator('#form-field-formNumber');
  await formNumber.getByRole('button', { name: 'Правило заполнения' }).click();
  await expect(formNumber.getByRole('note')).toContainText('не определяет');

  // Validation comes from the schema.
  const icd = page.locator('#form-field-diagnosisIcd');
  await icd.getByRole('textbox').fill('J451');
  await expect(icd).toContainText('Код МКБ-10 в формате J45.0');
  await icd.getByRole('textbox').fill('J45.0');
  await expect(icd).not.toContainText('Код МКБ-10 в формате J45.0');

  await formNumber.getByRole('textbox').fill('17');
  await preferredPlace.getByRole('textbox').fill('Санаторий в Кисловодске');
  await page.locator('#form-field-seasons').getByRole('checkbox', { name: 'Лето' }).check();
  await page
    .locator('#form-field-treatmentSetting')
    .getByRole('radio', { name: /санаторно-курортной организации/u })
    .check();
  await page.locator('#form-field-regionCode').getByRole('combobox').selectOption('45');

  // 4. The print preview shows the filled blank.
  await page.getByRole('button', { name: 'Предпросмотр и печать' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toBeVisible();
  const frame = page.frameLocator('iframe[title="Предпросмотр бланка"]');
  await expect(frame.locator('.form-print')).toContainText(
    'для получения путевки на санаторно-курортное лечение',
  );
  await expect(frame.locator('.form-print')).toContainText('Иванов Иван Иванович');
  await expect(frame.locator('.form-print')).toContainText('ГБУЗ «Городская поликлиника № 1»');
  await expect(
    frame.locator('.form-print__option--picked').filter({ hasText: 'муж. – 1' }),
  ).toBeVisible();
  await expect(
    frame.locator('.form-print__option--picked').filter({ hasText: 'лето – 3' }),
  ).toBeVisible();
  await expect(frame.locator('.form-print__blank').filter({ hasText: /^45$/u })).toBeVisible();
  await capture(page, 'form-070u-preview');

  // «Печать / PDF» hands the same page to the print manager (a popup in the browser).
  const popupPromise = page.waitForEvent('popup');
  await preview.getByRole('button', { name: 'Печать / PDF' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('.form-print')).toContainText('Иванов Иван Иванович');
  await popup.close();

  // Typed values survive leaving the screen and coming back.
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'К карточке пациента' }).click();
  await expect(page.getByRole('heading', { name: 'Пациент для справки' })).toBeVisible();
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.locator('#form-field-formNumber').getByRole('textbox')).toHaveValue('17');
});

test('«Мои файлы» opens the official forms from a pinned «Формы» folder', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    persistentOrigin: true,
    skipLargeCompanionPacks: true,
    splitNavigation: false,
  });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  const folder = page.locator('.user-library-folder-card').filter({ hasText: 'Формы' });
  await expect(folder).toBeVisible();
  await expect(folder).toContainText('Официальные бланки Минздрава');
  await capture(page, 'files-forms-folder');
  await folder.click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/notes\/forms$/u);
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();

  // Without a patient the blank is still filled from «Врач и организация» and today's date.
  await expect(page.getByRole('heading', { name: /Справка для получения путевки/u })).toBeVisible();
  await expect(page.locator('#form-field-formDate').getByText('подставлено')).toBeVisible();
  await expect(page.locator('#form-field-patientFullName')).toHaveClass(/form-field--missing/u);
  await page.getByRole('button', { name: 'Выбрать пациента' }).click();
  await expect(
    page.getByRole('heading', { name: /^(Карточки пациентов без шифрования|Пациенты закрыты)$/u }),
  ).toBeVisible();
});
