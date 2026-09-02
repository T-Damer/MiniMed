import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

async function selectPatient(page: Page, name: string): Promise<void> {
  const field = page.getByRole('combobox', {
    name: 'Пациент / случай — необязательно',
    exact: true,
  });
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

test('patient list has a safe sticky header, local search, and grouped actions', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Продолжить без шифрования' }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.patient-workspace__empty')).toContainText('Карточек пока нет.');
  await expect(page.locator('.patient-workspace__empty-icon')).toBeVisible();
  await page.getByRole('button', { name: 'Новый пациент', exact: true }).click();
  await page.getByLabel('Имя или псевдоним').fill('Пациент для поиска');
  await page.getByRole('button', { name: 'Создать карточку', exact: true }).click();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();

  const search = page.locator('#patient-workspace-search');
  const patientCard = page.getByRole('button', { name: /^Пациент для поиска/u });
  const header = page.locator('.patient-workspace__search-chrome');
  await expect(search).toBeVisible();
  await expect(patientCard).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад к заметкам', exact: true })).toBeVisible();
  await expect(page.locator('.patient-workspace__page .page__icon')).toBeVisible();
  await expect(page.locator('.patient-workspace')).not.toHaveClass(/page-grain/u);
  await search.fill('для поиска');
  await expect(patientCard).toHaveCount(1);
  await search.fill('неизвестный пациент');
  await expect(page.getByText('По запросу ничего не найдено.')).toBeVisible();

  await page.getByRole('button', { name: 'Действия с пациентами' }).click();
  await expect(page.getByRole('menuitem', { name: 'Заблокировать', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Экспорт backup', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Импорт backup', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Удалить всё', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    shell?.classList.add('app-shell--native');
    document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
    const workspace = document.querySelector('.patient-workspace');
    if (workspace) workspace.style.minHeight = '80rem';
    window.scrollTo(0, 320);
  });
  await expect(header).toHaveClass(/sticky-surface--stuck/u);
  await expect
    .poll(async () => header.evaluate((element) => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(43);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).not.toHaveClass(/sticky-surface--stuck/u);

  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  const personalScope = page.getByRole('radio', { name: 'Ваши данные', exact: true });
  await expect(personalScope).toBeEnabled();
  await personalScope.check();
  await page.getByTestId('search-input').fill('Пациент для поиска');
  await expect(
    page.locator('.personal-note-matches__card--hit').filter({ hasText: 'Пациент для поиска' }),
  ).toBeVisible();
});

test('creates a protected patient profile and opens longitudinal dynamics', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');

  await expect(page.getByRole('heading', { name: 'Хранилище без шифрования' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить без шифрования' }).click();
  await expect(page.getByRole('heading', { name: 'Новая карточка пациента' })).toBeVisible();
  await page.getByLabel('Имя или псевдоним').fill('Пациент динамики');
  await page.getByLabel('Дата рождения').fill('2020-01-02');
  await page.getByLabel('Масса, кг').fill('20');
  await page.getByLabel('Рост, см').fill('110');
  await page.getByRole('button', { name: 'Создать карточку' }).click();

  await expect(page.getByRole('heading', { name: 'Пациент динамики' })).toBeVisible();
  await expect(page.getByText('20 кг')).toBeVisible();
  await expect(page.getByText('110 см')).toBeVisible();
  await page.getByPlaceholder('Краткая запись осмотра').fill('Первичный осмотр');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();

  // Manual observations, a lab result, and medication markers stay inside the protected profile.
  await page.getByRole('button', { name: 'АД верхнее', exact: true }).click();
  await page.getByLabel('Значение', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(3);
  await page.getByRole('button', { name: 'АД нижнее', exact: true }).click();
  await page.getByLabel('Значение', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(4);
  await page.getByRole('button', { name: 'Пульс', exact: true }).click();
  await page.getByLabel('Значение', { exact: true }).fill('72');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(5);
  const systolicEvent = page.locator('.patient-workspace__event').filter({
    hasText: 'Давление: систолическое',
  });
  await expect(systolicEvent).toHaveCount(1);
  await systolicEvent.getByRole('button', { name: 'Исправить значение', exact: true }).click();
  await systolicEvent.getByLabel('Новое значение', { exact: true }).fill('121');
  await systolicEvent.getByRole('button', { name: 'Сохранить исправление', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(6);
  await expect(
    page.locator('.patient-workspace__event').filter({ hasText: 'Заменено исправлением.' }),
  ).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Тип события', exact: true }).selectOption('laboratory');
  await page.getByLabel('Значение', { exact: true }).fill('6');
  await page.getByLabel('Референс с бланка', { exact: true }).fill('3,5–5,5 ммоль/л');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(7);
  await page.getByRole('combobox', { name: 'Тип события', exact: true }).selectOption('medication');
  await page.getByLabel('Препарат', { exact: true }).fill('Тестовый препарат');
  await page.getByRole('combobox', { name: 'Событие лечения', exact: true }).selectOption('start');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(8);
  await page
    .getByRole('combobox', { name: 'Событие лечения', exact: true })
    .selectOption('dose-change');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(9);
  await page.getByRole('combobox', { name: 'Событие лечения', exact: true }).selectOption('stop');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('.patient-workspace__event')).toHaveCount(10);
  await expect(page.getByText('Выше диапазона бланка')).toBeVisible();

  // Patient-bound calculator fields are prefilled, its evaluation is shown, and the result is
  // persisted to the patient profile rather than the ordinary notes store.
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
  const anthropometryDownload = page.getByRole('button', {
    name: 'Скачать раздел «Антропометрия»',
  });
  if (await anthropometryDownload.count()) await anthropometryDownload.click();
  await page.getByTestId('calculator-open-body-surface-area-mosteller').click();
  await selectPatient(page, 'Пациент динамики');
  const calculatorEpisode = page.getByTestId('calculator-episode-select');
  await expect(calculatorEpisode.locator('option')).toHaveCount(2);
  await calculatorEpisode.selectOption({ index: 1 });
  await expect(calculatorEpisode).not.toHaveValue('');
  await expect(page.getByLabel('Рост, см')).toHaveValue('110');
  await expect(page.getByLabel('Масса, кг')).toHaveValue('20');
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByTestId('calculator-result')).toContainText('0,78 м²');
  await expect(page.getByText('Результат записан в защищённую карточку.')).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
  await page.getByRole('button', { name: /^Пациент динамики/u }).click();
  const calculatorEvent = page.locator('.patient-workspace__event').filter({
    hasText: 'Площадь поверхности тела — Mosteller',
  });
  await expect(calculatorEvent).toBeVisible();
  await expect(calculatorEvent).toHaveAttribute('data-episode-id', /.+/u);
  await page.getByRole('button', { name: 'Динамика' }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\/[^/]+\/dynamics$/u);
  await expect(page.getByRole('heading', { name: 'Динамика' })).toBeVisible();
  await expect(page.getByRole('button', { name: /body-mass/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /body-height/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'blood-pressure', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'pulse', exact: true })).toBeVisible();
  await expect(page.locator('.patient-dynamics__table')).toHaveCount(5);
  await expect(page.getByText('Лекарственные интервалы и маркеры')).toBeVisible();
  await expect(page.getByRole('button', { name: /Начало лечения/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /Изменение дозы/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /Отмена/u })).toBeVisible();

  const calculatorSource = page.getByRole('button', { name: /body-surface-area-mosteller/u });
  await calculatorSource.click();
  await expect(page.getByText(/Версия инструмента: 1\.0\.0/u)).toBeVisible();
  await expect(page.getByText(/Результат: Площадь поверхности тела/u)).toBeVisible();
  const methodologyLink = page.getByRole('link', {
    name: 'Simplified calculation of body-surface area',
  });
  await expect(methodologyLink).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/3657876/');
  await expect(page.locator('a[href^="#/search"]')).toHaveCount(0);
  await expect(
    calculatorEvent.getByRole('button', { name: 'Исправить значение', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть событие', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть осмотр', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\/[^?]+\?episode=.+$/u);
  await expect(page.locator('.patient-workspace__episode--active')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toHaveCount(0);
  await page.getByRole('button', { name: 'Динамика', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\/[^/]+\/dynamics$/u);
  await page.getByRole('button', { name: /body-surface-area-mosteller/u }).click();
  await page.getByRole('button', { name: 'Открыть осмотр', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\/[^?]+\?episode=.+$/u);
  await expect(page.getByText(/Текущий осмотр закрыт:/u)).toBeVisible();
  await expect(page.locator('.patient-workspace__episode--active')).toHaveCount(1);
  await page.getByRole('button', { name: 'АД верхнее', exact: true }).click();
  await page.getByLabel('Значение', { exact: true }).fill('122');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(
    page
      .locator('.patient-workspace__event[data-episode-id=""]')
      .filter({ hasText: 'Давление: систолическое' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Динамика', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\/[^/]+\/dynamics$/u);

  // Creating another profile must append to the patient snapshot, not replace the first
  // patient's profile and measurements.
  await page.getByRole('button', { name: /^Пациент динамики/u }).click();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
  await page.getByRole('button', { name: 'Новый пациент' }).click();
  await page.getByLabel('Имя или псевдоним').fill('Второй пациент');
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name: 'Второй пациент' })).toBeVisible();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Пациент динамики/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Второй пациент/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Пациент динамики/u })).toContainText('20 кг');

  const localStorageValues = await page.evaluate(() => Object.values(localStorage));
  expect(localStorageValues.some((value) => value.includes('Пациент динамики'))).toBe(false);

  // Locking from the patient workspace is the production curtain emitter. The mounted calculator
  // must drop its selected patient and transient result before the curtain can clear.
  await page.getByRole('button', { name: /^Пациент динамики/u }).click();
  await page.getByRole('button', { name: 'Заблокировать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Хранилище без шифрования' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/patient-vault--privacy-curtain/u);
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await expect(page.locator('.calculator-form select').first()).toHaveValue('');
  await expect(page.getByTestId('calculator-result')).toHaveCount(0);
});

test('repeats an assessment for the same protected patient', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: /^Пациенты/u }).click();
  await page.getByRole('button', { name: 'Продолжить без шифрования' }).click();
  await page.getByRole('button', { name: 'Новый пациент' }).click();
  await page.getByLabel('Имя или псевдоним').fill('Пациент повторной оценки');
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await page.getByPlaceholder('Краткая запись осмотра').fill('Оценочный осмотр');
  await page.getByRole('button', { name: 'Создать осмотр', exact: true }).click();
  await expect(page.getByText(/Текущий осмотр открыт:/u)).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^База знаний/u })
    .click();
  await page.getByRole('article', { name: 'Открыть набор «Калькуляторы и опросники»' }).click();
  const obstetricsToolPack = page
    .locator('.module-card')
    .filter({ hasText: 'Инструменты акушерства и гинекологии' });
  const obstetricsToolDownload = obstetricsToolPack.getByRole('button', {
    name: /Скачать «Инструменты акушерства и гинекологии»/u,
  });
  if (await obstetricsToolDownload.count()) {
    await obstetricsToolDownload.click();
    await expect(obstetricsToolPack).toContainText('Установлено');
  }
  await page.getByRole('button', { name: 'Тесты', exact: true }).click();
  await expect(page.getByTestId('assessment-specialty-obstetrics')).toBeEnabled();
  await page.getByTestId('assessment-specialty-obstetrics').click();
  await page.getByRole('button', { name: 'Открыть раздел «Психологический скрининг»' }).click();
  const sectionDownload = page.getByTestId('assessment-section-perinatal-mood');
  if (await sectionDownload.count()) {
    await sectionDownload.click();
    await expect(page.getByText('Раздел опросников скачан на устройство.')).toBeVisible();
  }

  await page.goto(`${E2E_ASSET_ORIGIN}/#/assessments/obstetrics/perinatal-mood-whooley`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('.assessment-question input[value="1"]')
    .first()
    .evaluate((input: HTMLInputElement) => input.click());
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('minimed.assessment-results.v2');
        return raw ? (JSON.parse(raw) as readonly unknown[]).length : 0;
      }),
    )
    .toBe(1);
  await selectPatient(page, 'Пациент повторной оценки');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('minimed.assessment-results.v2');
        return raw ? (JSON.parse(raw) as readonly unknown[]).length : 0;
      }),
    )
    .toBe(0);
  await expect(page.locator('.assessment-question input:checked')).toHaveCount(0);

  const completeAssessment = async (answer: '0' | '1', episodeIndex: 0 | 1): Promise<void> => {
    await page.goto(`${E2E_ASSET_ORIGIN}/#/assessments/obstetrics/perinatal-mood-whooley`, {
      waitUntil: 'domcontentloaded',
    });
    await selectPatient(page, 'Пациент повторной оценки');
    const episodeSelect = page.getByTestId('assessment-episode-select');
    await expect(episodeSelect.locator('option')).toHaveCount(2);
    await episodeSelect.selectOption({ index: episodeIndex });
    const answers = page.locator(`.assessment-question input[value="${answer}"]`);
    await expect(answers).toHaveCount(2);
    await answers.nth(0).evaluate((input: HTMLInputElement) => input.click());
    await answers.nth(1).evaluate((input: HTMLInputElement) => input.click());
    await page.getByTestId('assessment-submit').click();
    await expect(page).toHaveURL(/#\/assessments\/obstetrics\/perinatal-mood-whooley\/results\//u);
    await expect(
      page.getByRole('heading', { name: 'Скрининг настроения Whooley (2 вопроса)' }),
    ).toBeVisible();
  };

  await completeAssessment('1', 1);
  await completeAssessment('0', 0);

  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Пациенты', exact: true }).click();
  await page.getByRole('button', { name: /^Пациент повторной оценки/u }).click();
  const assessmentEvents = page.locator('.patient-workspace__event').filter({
    hasText: 'Скрининг настроения Whooley (2 вопроса)',
  });
  await expect(assessmentEvents).toHaveCount(2);
  await expect(assessmentEvents.nth(0)).toHaveAttribute('data-episode-id', '');
  await expect(assessmentEvents.nth(1)).toHaveAttribute('data-episode-id', /.+/u);
});
