import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Locator, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';
import { openSettingsPage } from './settings-nav';

const SCREENS = resolve(import.meta.dirname, '../../../output/f1-screens');
const CAPTURE = process.env['F1_CAPTURE_SCREENS'] === '1';
const SCREENS_F2 = resolve(import.meta.dirname, '../../../output/f2-screens');
const CAPTURE_F2 = process.env['F2_CAPTURE_SCREENS'] === '1';

/** Saves the current screen at 390 px in both colour schemes (F1_CAPTURE_SCREENS=1). */
async function capture(page: Page, name: string, f2 = false): Promise<void> {
  if (f2 ? !CAPTURE_F2 : !CAPTURE) return;
  const directory = f2 ? SCREENS_F2 : SCREENS;
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${directory}/${name}-${scheme}.png`, fullPage: false });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * Number of sheets in the PDF Chromium makes from the print page (real pagination). The page is
 * the same HTML the preview shows and the print popup receives; the popup closes itself after
 * printing, so the markup is taken from the preview frame.
 */
async function pdfSheetCount(page: Page): Promise<number> {
  const html = await page.locator('iframe[title="Предпросмотр бланка"]').getAttribute('srcdoc');
  expect(html).toContain('class="form-print"');
  const sheet = await page.context().newPage();
  try {
    await sheet.setContent(html ?? '');
    const pdf = await sheet.pdf({ preferCSSPageSize: true });
    return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/gu) ?? []).length;
  } finally {
    await sheet.close();
  }
}

/** The «Заполнить форму» button of one card of the forms list. */
function fillButton(page: Page, formNumber: string): Locator {
  return page
    .locator('.forms-home__card')
    .filter({ hasText: `Форма № ${formNumber}` })
    .getByRole('button', { name: 'Заполнить форму', exact: true });
}

async function openPatientVault(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
}

/** «Врач и организация» in Settings, then a patient with the data forms need and one episode. */
async function seedClinicianAndPatient(page: Page): Promise<void> {
  // 1. «Врач и организация» in Settings — device-local, filled into every form.
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await openSettingsPage(page, 'Врач и организация');
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
  await page.getByLabel('Место работы / учёбы').fill('ООО «Тест»');
  await page.getByLabel('Гражданство').fill('Российская Федерация');
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
}

test('fills form 070/у from a patient card, shows the rule behind a field and previews the print', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });

  await seedClinicianAndPatient(page);

  // 3. «Заполнить форму» from the patient card opens the list, then the form.
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();
  await capture(page, 'forms-list');
  await fillButton(page, '070/у').click();
  await expect(page).toHaveURL(/#\/notes\/forms\/ru\.minzdrav\.274n\.070u\?patient=/u);

  const fullName = page.locator('#form-field-patientFullName');
  await expect(fullName.getByRole('textbox')).toHaveValue('Иванов Иван Иванович');
  await expect(fullName).toHaveClass(/form-field--prefilled/u);
  // One compact row names the patient: avatar, full name and birth date.
  await expect(page.locator('.patient-picker-row')).toContainText('Пациент для справки');
  await expect(page.locator('.patient-picker-row')).toContainText('04.03.1980');
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

  await page.locator('.forms-workspace .page').scrollIntoViewIfNeeded();
  await capture(page, 'form-070u-top');

  // A fresh form is not red: one progress line counts the required fields and says «Черновик».
  const preferredPlace = page.locator('#form-field-preferredPlace');
  await expect(preferredPlace).not.toHaveClass(/form-field--missing/u);
  await expect(page.locator('.form-progress__count')).toHaveText(/^\d+\/\d+$/u);
  await expect(page.locator('.form-progress__state')).toHaveText('Черновик');
  // A tap on the progress marks what is still empty.
  await page.getByRole('button', { name: /^Обязательные поля: \d+ из \d+$/u }).click();
  await expect(preferredPlace).toHaveClass(/form-field--missing/u);

  // The rule behind a field is a «?» in its label that opens the order's paragraph.
  await preferredPlace.getByRole('button', { name: 'Правило заполнения' }).click();
  const rule = page.getByRole('note');
  await expect(rule).toContainText('6.12.');
  await expect(rule).toContainText('перечнем медицинских показаний');
  await expect(rule).toContainText('приложение № 6 к приказу № 274н), п. 6.12');
  await capture(page, 'form-070u-rule');
  await page.keyboard.press('Escape');
  await expect(rule).toHaveCount(0);
  // A field the order leaves undefined has no «?» at all.
  const formNumber = page.locator('#form-field-formNumber');
  await expect(formNumber.getByRole('button', { name: 'Правило заполнения' })).toHaveCount(0);
  await preferredPlace.scrollIntoViewIfNeeded();

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

  // The printer button hands the same page to the print manager (a popup in the browser). The
  // popup closes itself once printing ends, which headless Chromium reports at once: print is
  // stubbed so the page stays open long enough to be read.
  await page.context().addInitScript(() => {
    window.print = () => undefined;
  });
  const popupPromise = page.waitForEvent('popup');
  await preview.getByRole('button', { name: 'Печать', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('.form-print')).toContainText('Иванов Иван Иванович');
  // The official 070/у is one sheet, and so is the printed page.
  expect(await pdfSheetCount(page)).toBe(1);
  await popup.close();

  // Typed values survive leaving the screen and coming back.
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'К карточке пациента' }).click();
  await expect(page.getByRole('heading', { name: 'Пациент для справки' })).toBeVisible();
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await fillButton(page, '070/у').click();
  await expect(page.locator('#form-field-formNumber').getByRole('textbox')).toHaveValue('17');
});

/** Per form: how it is reached, what the patient data fills in, and the printed sheets. */
const NEW_FORMS = [
  {
    id: 'ru.minzdrav.274n.072u',
    slug: '072u',
    ruleField: 'patientFullName',
    title: /Санаторно-курортная карта$/u,
    prefilled: { patientFullName: 'Иванов Иван Иванович', mainDiagnosisIcd: 'J45.0' },
    printed: ['Санаторно-курортная карта №', 'Иванов Иван Иванович', 'Обратный талон'],
    sheets: 2,
  },
  {
    id: 'ru.minzdrav.274n.076u',
    slug: '076u',
    ruleField: 'patientFullName',
    title: /Санаторно-курортная карта для детей/u,
    prefilled: { patientFullName: 'Иванов Иван Иванович', mainDiagnosisIcd: 'J45.0' },
    printed: ['Санаторно-курортная карта для детей №', 'Образовательная организация', 'прививки'],
    sheets: 2,
  },
  {
    id: 'ru.minzdrav.274n.079u',
    slug: '079u',
    ruleField: 'patientFullName',
    title: /Медицинская справка о состоянии здоровья ребенка/u,
    prefilled: { patientFullName: 'Иванов Иван Иванович', citizenship: 'Российская Федерация' },
    printed: ['Гражданство', 'Российская Федерация', 'Отсутствие медицинских противопоказаний'],
    sheets: 2,
  },
  {
    id: 'ru.minzdrav.274n.025-1u',
    slug: '025-1u',
    ruleField: 'surname',
    title: /Талон пациента, получающего медицинскую помощь/u,
    prefilled: {
      surname: 'Иванов',
      firstName: 'Иван',
      patronymic: 'Иванович',
      workplace: 'ООО «Тест»',
      prelimDiagnosisIcd: 'J45.0',
    },
    printed: ['ТАЛОН ПАЦИЕНТА', 'ООО «Тест»', '25. Даты посещений', 'Рецепты на лекарственные'],
    sheets: 2,
  },
] as const;

test('fills 072/у, 076/у, 079/у and 025-1/у from one patient and previews every blank', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await seedClinicianAndPatient(page);
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();
  const cards = page.locator('.forms-home__card');
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  for (const number of ['070/у', '072/у', '076/у', '079/у', '025-1/у']) {
    await expect(cards.filter({ hasText: `Форма № ${number}` })).toHaveCount(1);
  }
  await capture(page, 'forms-list', true);

  for (const [index, form] of NEW_FORMS.entries()) {
    if (index > 0) {
      // Back to the patient card and the list; a reload would lock the vault again.
      await page.getByRole('button', { name: 'К карточке пациента' }).click();
      await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
    }
    await fillButton(page, form.slug.replace('u', '/у')).click();
    await expect(page).toHaveURL(
      new RegExp(`#/notes/forms/${form.id.replaceAll('.', '\\.')}\\?`, 'u'),
    );
    await expect(page.locator('.forms-workspace .page__description')).toHaveText(form.title);

    for (const [fieldId, value] of Object.entries(form.prefilled)) {
      const field = page.locator(`#form-field-${fieldId}`);
      await expect(field.getByRole('textbox').first()).toHaveValue(value);
      await expect(field).toHaveClass(/form-field--prefilled/u);
    }
    // A rule is one tap away and the order's own paragraph is quoted.
    const ruled = page.locator(`#form-field-${form.ruleField}`);
    await ruled.scrollIntoViewIfNeeded();
    await ruled.getByRole('button', { name: 'Правило заполнения' }).click();
    await expect(page.getByRole('note')).toContainText('приказу № 274н');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('note')).toHaveCount(0);
    await page.locator('.forms-workspace .page').scrollIntoViewIfNeeded();
    await capture(page, `form-${form.slug}-fill`, true);

    await page.getByRole('button', { name: 'Предпросмотр и печать' }).click();
    const frame = page.frameLocator('iframe[title="Предпросмотр бланка"]');
    for (const phrase of form.printed) {
      await expect(frame.locator('.form-print')).toContainText(phrase);
    }
    await expect(frame.locator('.form-print__block--page-break')).toHaveCount(1);
    await capture(page, `form-${form.slug}-preview`, true);

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('dialog').getByRole('button', { name: 'Печать', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    // Two-sided blanks print as two sheets: the reverse side starts on a new page.
    expect(await pdfSheetCount(page)).toBe(form.sheets);
    await popup.close();
    await page.getByRole('button', { name: 'Закрыть' }).click();
  }
});

test('fills the referral 057/у (order 519н) from one patient: prefill, underlined answers, one printed sheet', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await seedClinicianAndPatient(page);
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();

  // The list card is the form number and name only; the order, the dates of validity and the
  // official publication are small text at the bottom of the form page. A coming edition is never
  // shown as current.
  const card = page.locator('.forms-home__card').filter({ hasText: 'Форма № 057/у' });
  await expect(card).not.toContainText('Приказ');
  await expect(card).not.toContainText('Официальная публикация');
  await expect(page.locator('.forms-home__card')).toHaveCount(13);
  await fillButton(page, '058/у').click();
  const comingReference = page.locator('.forms-workspace__reference');
  await expect(comingReference).toContainText('Вступает в силу с 01.03.2027.');
  await expect(comingReference).not.toContainText('Действует с');
  await page.getByRole('button', { name: 'К карточке пациента' }).click();
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await fillButton(page, '057/у').click();
  await expect(page).toHaveURL(/#\/notes\/forms\/ru\.minzdrav\.519n\.057u\?patient=/u);
  const reference = page.locator('.forms-workspace__reference');
  await expect(reference).toContainText('Приказ Минздрава России от 02.09.2025 № 519н');
  await expect(reference).toContainText('зарегистрирован Минюстом');
  await expect(reference).toContainText('Действует с 27.10.2025.');

  for (const [fieldId, value] of Object.entries({
    patientFullName: 'Иванов Иван Иванович',
    omsPolicyNumber: '7700000000000001',
    omsInsurer: 'СМО «Тест»',
    residenceStreet: 'Ленина',
    diagnosis: 'Бронхиальная астма, J45.0',
    referrerPosition: 'врач-терапевт',
    referrerName: 'Петров Пётр Петрович',
    organizationOgrn: '1027700132195',
  })) {
    const field = page.locator(`#form-field-${fieldId}`);
    await expect(field.getByRole('textbox').first()).toHaveValue(value);
    await expect(field).toHaveClass(/form-field--prefilled/u);
  }
  await expect(
    page.locator('#form-field-patientSex').getByRole('radio', { name: 'Муж' }),
  ).toBeChecked();

  // A line the order does not define has no «?»; a defined one quotes the order's own paragraph.
  const locality = page.locator('#form-field-localityType');
  await expect(locality.getByRole('button', { name: 'Правило заполнения' })).toHaveCount(0);
  const addressRule = page.locator('#form-field-residenceStreet');
  await addressRule.getByRole('button', { name: 'Правило заполнения' }).click();
  await expect(page.getByRole('note')).toContainText('их части порядок отдельно не определяет');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
  const justification = page.locator('#form-field-justification');
  await justification.scrollIntoViewIfNeeded();
  await justification.getByRole('button', { name: 'Правило заполнения' }).click();
  await expect(page.getByRole('note')).toContainText('9.8.');
  await expect(page.getByRole('note')).toContainText('число назначаемых курсов');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);

  await page.locator('#form-field-formNumber').getByRole('textbox').fill('12');
  await page.locator('#form-field-purpose').getByRole('textbox').fill('консультация пульмонолога');
  await page
    .locator('#form-field-justification')
    .getByRole('textbox')
    .fill('Неконтролируемое течение, 1 курс');
  await page.locator('#form-field-careForm').getByRole('radio', { name: 'Плановая' }).check();
  await page
    .locator('#form-field-careConditions')
    .getByRole('radio', { name: 'Амбулаторно' })
    .check();

  await page.getByRole('button', { name: 'Предпросмотр и печать' }).click();
  const frame = page.frameLocator('iframe[title="Предпросмотр бланка"]');
  const sheet = frame.locator('.form-print');
  await expect(sheet).toContainText('НАПРАВЛЕНИЕ ДЛЯ ОКАЗАНИЯ МЕДИЦИНСКОЙ ПОМОЩИ №');
  await expect(sheet).toContainText('Иванов Иван Иванович');
  await expect(sheet).toContainText('консультация пульмонолога');
  // The order asks the doctor to underline the chosen answers (п. 6).
  await expect(
    frame.locator('.form-print__option--underlined').filter({ hasText: /^плановая – 3$/u }),
  ).toBeVisible();
  await expect(
    frame.locator('.form-print__option--underlined').filter({ hasText: /^амбулаторно – 1$/u }),
  ).toBeVisible();
  await expect(
    frame.locator('.form-print__option--underlined').filter({ hasText: /^экстренная – 1$/u }),
  ).toHaveCount(0);
  await capture(page, 'form-057u-preview', true);

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('dialog').getByRole('button', { name: 'Печать', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  // One official sheet, printed at the declared font (the page is not shrunk to fit).
  expect(await pdfSheetCount(page)).toBe(1);
  await popup.close();
});

test('autosaves a draft in the patient vault and approves the form with «Сохранить»', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await seedClinicianAndPatient(page);
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await fillButton(page, '148-1/у-04(л)').click();
  await expect(page).toHaveURL(/#\/notes\/forms\/ru\.minzdrav\.1094n\.148-1u-04l\?patient=/u);

  const state = page.locator('.form-progress__state');
  const save = page.getByRole('button', { name: 'Сохранить', exact: true });
  const prescription = page.locator('#form-field-prescription');
  const signa = page.locator('#form-field-signa');
  await expect(state).toHaveText('Черновик');

  // Approving an unfinished form only shows what is missing.
  await save.click();
  await expect(prescription).toHaveClass(/form-field--missing/u);
  await expect(state).toHaveText('Черновик');

  await prescription.getByRole('textbox').fill('Амоксициллин 500 мг');
  await signa.getByRole('textbox').fill('По 1 таблетке 3 раза в день');
  await expect(prescription).not.toHaveClass(/form-field--missing/u);
  // The header thumbnail is the real print and follows the typing (debounced).
  await expect(page.locator('.form-thumbnail__frame')).toHaveAttribute(
    'srcdoc',
    /Амоксициллин 500 мг/u,
  );

  await save.click();
  await expect(state).toHaveText(/^Сохранено · /u);
  await expect(save).toBeDisabled();
  await capture(page, 'form-saved');

  // A change makes it a draft again.
  await signa.getByRole('textbox').fill('По 1 таблетке 2 раза в день');
  await expect(state).toHaveText('Черновик');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(state).toHaveText(/^Сохранено · /u);

  // The draft is in the encrypted vault: it is back after a reload and after opening the vault.
  await signa.getByRole('textbox').fill('По 1 таблетке 1 раз в день');
  await expect(state).toHaveText('Черновик');
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('#form-field-signa').getByRole('textbox')).toHaveValue(
    'По 1 таблетке 1 раз в день',
  );
  await expect(page.locator('#form-field-prescription').getByRole('textbox')).toHaveValue(
    'Амоксициллин 500 мг',
  );
  await expect(page.locator('.form-progress__state')).toHaveText('Черновик');
});

/** The forms of F3 beyond 057/у: how many sheets the official blank has and what the print shows. */
const F3_FORMS = [
  { number: '088/у', sheets: 13, printed: /направление на медико-социальную экспертизу/iu },
  { number: '107-1/у', sheets: 2, printed: /рецепт/iu },
  { number: '148-1/у-88', sheets: 2, printed: /рецепт/iu },
  { number: '148-1/у-04(л)', sheets: 2, printed: /рецепт/iu },
  { number: '003-В/у', sheets: 1, printed: /медицинское заключение/iu },
  { number: '071/у', sheets: 2, printed: /заключение/iu },
  { number: '058/у', sheets: 2, printed: /экстренное извещение/iu },
] as const;

test('opens 088/у, the prescription blanks, the certificates and 058/у, prefilled, and prints the sheets of the official blank', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await seedClinicianAndPatient(page);
  await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Формы', exact: true })).toBeVisible();

  for (const [index, form] of F3_FORMS.entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'К карточке пациента' }).click();
      await page.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
    }
    await fillButton(page, form.number).click();
    await expect(
      page.locator('#form-field-patientFullName, #form-field-organization').first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Предпросмотр и печать' }).click();
    const frame = page.frameLocator('iframe[title="Предпросмотр бланка"]');
    await expect(frame.locator('.form-print')).toContainText(form.printed);
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('dialog').getByRole('button', { name: 'Печать', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(await pdfSheetCount(page), form.number).toBe(form.sheets);
    await popup.close();
    await page.getByRole('button', { name: 'Закрыть' }).click();
  }
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
  await fillButton(page, '070/у').click();

  // Without a patient the blank is still filled from «Врач и организация» and today's date.
  await expect(page.locator('.forms-workspace .page__description')).toContainText(
    'Справка для получения путевки',
  );
  await expect(page.locator('#form-field-formDate')).toHaveClass(/form-field--prefilled/u);
  // «Сохранить» with required fields empty marks them instead of approving the form.
  await expect(page.locator('#form-field-patientFullName')).not.toHaveClass(/form-field--missing/u);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('#form-field-patientFullName')).toHaveClass(/form-field--missing/u);
  await expect(page.locator('.form-progress__state')).toHaveText('Черновик');
  await page.getByRole('button', { name: 'Выбрать пациента', exact: true }).click();
  // The chooser opens the vault silently and lists the patients; no consent sheet comes first.
  await expect(
    page.getByRole('dialog', { name: 'Пациент', exact: true }).getByRole('button', {
      name: 'Добавить пациента',
      exact: true,
    }),
  ).toBeVisible();
});
