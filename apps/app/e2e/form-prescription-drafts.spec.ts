import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// DRAFT1: official forms, «Назначение», the note under an assessment result and the user
// calculator editor debounce their saves (~350-700 ms). Text typed inside that window must survive
// a reload: every change is sealed into a write-ahead copy at once (forms, patient prescriptions),
// written to browser storage at once (prescription without a patient, the assessment note) or
// flushed when the page is hidden or unloaded (calculator editor).

/** Reload this long after the last keystroke: well inside every debounce. */
const RELOAD_DELAYS_MS = [0, 300];

const FORM_ID = 'ru.minzdrav.274n.070u';

async function createPatient(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).first().click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await page.getByLabel('Имя или псевдоним').fill(name);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const match = /#\/notes\/patients\/([^/?]+)/u.exec(page.url());
  if (!match?.[1]) throw new Error(`patient id not found in ${page.url()}`);
  return decodeURIComponent(match[1]);
}

async function goToHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
}

const copyIsGone = (page: Page, key: string) =>
  expect
    .poll(() => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key), {
      timeout: 15_000,
    })
    .toBeNull();

for (const delayMs of RELOAD_DELAYS_MS) {
  test(`an official form keeps the last keystrokes of a reload ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    const patientId = await createPatient(page, `Пациент форма ${delayMs}`);
    await goToHash(page, `#/notes/forms/${FORM_ID}?patient=${encodeURIComponent(patientId)}`);

    const formNumber = page.locator('#form-field-formNumber').getByRole('textbox');
    const place = page.locator('#form-field-preferredPlace').getByRole('textbox');
    await expect(formNumber).toBeVisible();
    await formNumber.fill(`17-${delayMs}`);
    await place.fill(`Санаторий в Кисловодске ${delayMs}`);
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(formNumber).toHaveValue(`17-${delayMs}`);
    await expect(place).toHaveValue(`Санаторий в Кисловодске ${delayMs}`);
    // The restored text reaches the vault and the write-ahead copy is cleaned up.
    await copyIsGone(page, 'minimed.form-draft-ahead.v1');
    await page.reload();
    await expect(formNumber).toHaveValue(`17-${delayMs}`);
  });

  test(`a patient's prescription keeps its facts through a reload ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    const patientId = await createPatient(page, `Пациент назначение ${delayMs}`);
    await goToHash(page, `#/notes/prescription?patient=${encodeURIComponent(patientId)}`);

    const weight = page.getByTestId('prescription-weight');
    await expect(weight).toBeVisible();
    await weight.fill('23.5');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(page.getByTestId('prescription-weight')).toHaveValue('23.5');
    await copyIsGone(page, 'minimed.prescription-draft-ahead.v1');
    await page.reload();
    await expect(page.getByTestId('prescription-weight')).toHaveValue('23.5');
  });

  test(`a prescription without a patient keeps its facts through a reload ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    await goToHash(page, '#/notes/prescription');

    const weight = page.getByTestId('prescription-weight');
    await expect(weight).toBeVisible();
    await weight.fill('18');
    await page.waitForTimeout(delayMs);
    await page.reload();

    await expect(page.getByTestId('prescription-weight')).toHaveValue('18');
  });

  test(`the user calculator editor keeps its title through a reload ${delayMs} ms after typing`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
    await goToHash(page, '#/calculators/mine');
    await page.getByTestId('user-calculators-create').click();
    await expect(page).toHaveURL(/#\/calculators\/mine\/uc-[a-z0-9]+\/edit$/u);
    const editorUrl = page.url();

    const title = page.getByTestId('user-calculator-title');
    await expect(title).toBeVisible();
    await title.fill(`Мой индекс ${delayMs}`);
    await page.getByTestId('user-calculator-description').fill(`Описание ${delayMs}`);
    await page.waitForTimeout(delayMs);
    await page.reload();

    expect(page.url()).toBe(editorUrl);
    await expect(page.getByTestId('user-calculator-title')).toHaveValue(`Мой индекс ${delayMs}`);
    await expect(page.getByTestId('user-calculator-description')).toHaveValue(
      `Описание ${delayMs}`,
    );
  });
}

test('the card name typed under an assessment result survives a reload and is saved with the result', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.locator('.app-bottom-nav').getByRole('button', { name: 'Тесты', exact: true }).click();
  await page.getByTestId('assessment-specialty-psychology').click();
  await page
    .getByRole('button', { name: 'Открыть раздел «Самооценка и личностный профиль»' })
    .click();
  const download = page.getByRole('button', { name: 'Скачать «Профиль Бравермана»' });
  const open = page.getByTestId('assessment-open-braverman-behavioral-profile');
  await expect(download.or(open).first()).toBeVisible();
  if (await download.isVisible()) await download.click();
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await open.click();

  const middleAnswers = page.locator('.assessment-question input[value="3"]');
  await expect(middleAnswers).toHaveCount(24);
  for (let index = 0; index < 24; index += 1) {
    await middleAnswers.nth(index).evaluate((input: HTMLInputElement) => input.click());
  }
  await page.getByTestId('assessment-submit').click();
  await expect(page.locator('.assessment-score-list')).toBeVisible();
  const resultUrl = page.url();

  await page.getByTestId('assessment-save-note').click();
  const name = page.locator('.assessment-note-panel__input');
  await name.fill('Петрова Мария');
  await page.waitForTimeout(100);
  await page.reload();

  expect(page.url()).toBe(resultUrl);
  await expect(page.locator('.assessment-note-panel__input')).toHaveValue('Петрова Мария');

  // «Сохранить» uses the restored name and removes the draft.
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Результат записан в карточку пациента.')).toBeVisible();
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();
  await expect(page.locator('.patient-card').filter({ hasText: 'Петрова Мария' })).toBeVisible();
  expect(
    await page.evaluate(() => window.localStorage.getItem('minimed.assessment-note-drafts.v1')),
  ).toBeNull();
});
