import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('calculates an EDD by LMP and writes the result to a patient note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/calculators$/u);

  await page.getByRole('button', { name: 'Открыть раздел «Акушерство»' }).click();
  await expect(page.getByRole('heading', { name: 'Акушерство' })).toBeVisible();
  const installSection = page.getByRole('button', {
    // «Скачать раздел», «Скачать дополнения» or «Есть обновление», then the section title.
    name: /^(Скачать раздел|Скачать дополнения|Есть обновление) — Акушерство$/u,
  });
  const openEdd = page.getByTestId('calculator-open-obstetric-edd-lmp');
  await expect(installSection.or(openEdd).first()).toBeVisible();
  if (await installSection.isVisible()) await installSection.click();

  await openEdd.click();
  await expect(
    page.getByRole('heading', { name: 'ПДР по дате последней менструации' }),
  ).toBeVisible();

  await page.getByLabel('Дата последней менструации').fill('2026-05-01');
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByTestId('calculator-result')).toContainText('5 февраля 2027 г.');

  await page.getByTestId('calculator-save-note').click();
  await page.locator('.calculator-note-panel__input').fill('Пациентка калькулятора');
  await page.getByRole('button', { name: 'Записать результат' }).click();
  await expect(page.getByText('Расчёт записан в карточку пациента.')).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Пациентка калькулятора' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('5 февраля 2027 г.');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('5 февраля 2027 г.');
});

test('scores cervical readiness with the Bishop score calculator', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Акушерство»' }).click();
  const installSection = page.getByRole('button', {
    // «Скачать раздел», «Скачать дополнения» or «Есть обновление», then the section title.
    name: /^(Скачать раздел|Скачать дополнения|Есть обновление) — Акушерство$/u,
  });
  const openBishop = page.getByTestId('calculator-open-obstetric-bishop-score');
  await expect(installSection.or(openBishop).first()).toBeVisible();
  if (await installSection.isVisible()) await installSection.click();

  await openBishop.click();
  await expect(page.getByRole('heading', { name: 'Шкала Бишопа' })).toBeVisible();

  await page.getByLabel('Раскрытие шейки матки').selectOption({ label: '3–4 см (2)' });
  await page.getByLabel('Сглаживание шейки матки').selectOption({ label: '60–70% (2)' });
  await page.getByLabel('Положение головки (станция)').selectOption({ label: '−2 (1)' });
  await page.getByLabel('Консистенция шейки матки').selectOption({ label: 'Средняя (1)' });
  await page.getByLabel('Позиция шейки матки').selectOption({ label: 'Срединное положение (1)' });
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByTestId('calculator-result')).toContainText('7');
});

// Each section is downloaded on first use; both are small tool modules.
const DUE_DATE_SECTION = {
  title: 'Акушерство',
  slugs: [
    'obstetric-edd-lmp',
    'obstetric-edd-ultrasound',
    'obstetric-edd-conception',
    'obstetric-edd-quickening',
    'obstetric-edd-given-date',
    'obstetric-ga-from-edd',
    'obstetric-maternity-leave',
  ],
};
const FEEDING_SECTION = { title: 'Педиатрия', slugs: ['pediatric-feeding-plan'] };

async function installSection(page: Page, title: string): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/calculators';
  });
  await page.getByRole('button', { name: `Открыть раздел «${title}»` }).click();
  const install = page.getByRole('button', {
    name: new RegExp(`^(Скачать раздел|Скачать дополнения|Есть обновление) — ${title}$`, 'u'),
  });
  const first = page.locator('[data-testid^="calculator-open-"]').first();
  await expect(install.or(first).first()).toBeVisible();
  if (await install.isVisible()) await install.click();
  await expect(first).toBeVisible();
}

async function openCalculator(page: Page, slug: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `#/calculators/${target}`;
  }, slug);
  await expect(page.getByTestId('calculator-submit')).toBeVisible();
}

async function selectPatient(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^Выбрать (другого )?пациента$/u }).click();
  await page
    .getByRole('dialog', { name: 'Пациент', exact: true })
    .getByRole('button', { name: new RegExp(`^${name}`, 'u') })
    .click();
}

test('the due-date calculators and the feeding plan offer the patient row again', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  for (const section of [DUE_DATE_SECTION, FEEDING_SECTION]) {
    await installSection(page, section.title);
    for (const slug of section.slugs) {
      await openCalculator(page, slug);
      await expect(page.locator('.patient-picker-row')).toBeVisible();
    }
  }
});

test('a patient fills the feeding plan and keeps the last period and the due date', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await page.getByLabel('Имя или псевдоним').fill('Пациент ПДР');
  await page.getByLabel('Дата рождения').fill('2026-01-02');
  await page.getByLabel('Масса, кг').fill('7');
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name: 'Пациент ПДР' })).toBeVisible();

  // The feeding plan takes the age in months from the birth date and the weight from the card.
  await installSection(page, FEEDING_SECTION.title);
  await openCalculator(page, 'pediatric-feeding-plan');
  await selectPatient(page, 'Пациент ПДР');
  await expect(page.getByLabel(/^Возраст ребёнка/u)).toHaveValue(/^\d+(\.\d)?$/u);
  await expect(page.getByLabel(/^Масса ребёнка/u)).toHaveValue('7');

  // The due-date calculator writes the date to the card and fills its input next time.
  await installSection(page, DUE_DATE_SECTION.title);
  await openCalculator(page, 'obstetric-edd-lmp');
  await selectPatient(page, 'Пациент ПДР');
  await page.getByLabel('Дата последней менструации').fill('2026-05-01');
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByTestId('calculator-result')).toContainText('5 февраля 2027 г.');
  await expect(page.getByText('Результат записан в защищённую карточку.')).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = '#/calculators';
  });
  await openCalculator(page, 'obstetric-edd-lmp');
  await selectPatient(page, 'Пациент ПДР');
  await expect(page.getByLabel('Дата последней менструации')).toHaveValue('2026-05-01');

  // The due date found above fills the two calculators that start from it.
  // The patient stays when a link goes straight from one tool to another, and fills the new inputs.
  for (const slug of ['obstetric-ga-from-edd', 'obstetric-maternity-leave']) {
    await openCalculator(page, slug);
    await expect(page.getByLabel('Предполагаемая дата родов')).toHaveValue('2027-02-05');
    await expect(page.getByTestId('calculator-result')).toHaveCount(0);
  }
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByTestId('calculator-result')).toContainText('Начало отпуска');
  // The unit converter works on typed numbers: it neither keeps the patient nor writes to the card.
  await openCalculator(page, 'unit-conversion');
  await expect(page.locator('.patient-picker-row')).toHaveCount(0);
  await expect(page.getByTestId('calculator-episode-select')).toHaveCount(0);
  await expect(page.getByTestId('calculator-result')).toHaveCount(0);

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
  await page.getByRole('button', { name: /^Пациент ПДР/u }).click();
  await expect(
    page.locator('.patient-workspace__event').filter({ hasText: '5 февраля 2027 г.' }),
  ).toBeVisible();
});
