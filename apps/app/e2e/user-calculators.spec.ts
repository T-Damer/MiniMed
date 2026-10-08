import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';
import { openHomeSection } from './select-search-section';

interface PrintState {
  __printed: number;
  __printedHtml: string[];
}

/** Printing opens a popup and calls its print(); keep what was written to it. */
async function mockPrintPopup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as PrintState;
    state.__printed = 0;
    state.__printedHtml = [];
    window.open = (() => ({
      opener: null,
      document: {
        open() {},
        write(html: string) {
          state.__printedHtml.push(html);
        },
        close() {},
        images: [],
      },
      focus() {},
      close() {},
      print() {
        state.__printed += 1;
      },
    })) as unknown as typeof window.open;
    // Without the share sheet an export falls back to a plain file download.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
}

const card = (page: Page, title: string) =>
  page.getByTestId('user-calculator-card').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });

async function goTo(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('user-calculator-save-state')).toHaveText('Сохранено');
}

/** The age filter is a radio group; its labels are the clickable parts. */
async function ageFilter(page: Page, label: 'Дети' | 'Взрослые' | 'Все'): Promise<void> {
  await page
    .locator('[data-testid="tool-age-filter"]:visible')
    .getByText(label, { exact: true })
    .click();
}

/** Creates «Индекс Кетле» (children from 2 years) with two inputs, a formula and two ranges. */
async function createChildBmi(page: Page): Promise<string> {
  await goTo(page, '#/calculators/mine');
  await expect(page.getByTestId('user-calculators-empty')).toBeVisible();
  await page.getByTestId('user-calculators-create').click();
  await expect(page).toHaveURL(/#\/calculators\/mine\/uc-[a-z0-9]+\/edit$/u);
  const id = /\/(uc-[a-z0-9]+)\/edit$/u.exec(page.url())?.[1] ?? '';
  expect(id).not.toBe('');

  // Nothing can be opened until the author says whom the calculator is for.
  const open = page.getByTestId('user-calculator-editor-open');
  await expect(open).toBeDisabled();
  await expect(open).toHaveAttribute('title', /Укажите, для кого инструмент/u);

  await page.getByTestId('user-calculator-title').fill('Индекс Кетле');
  await page
    .getByTestId('user-calculator-description')
    .fill('Масса тела в кг на квадратный метр роста.');
  await page.getByTestId('tool-population').getByText('Дети', { exact: true }).click();
  await page.getByTestId('tool-population-min-value').fill('2');

  await page.getByTestId('user-calculator-add-input').click();
  const first = page.getByTestId('user-calculator-input-card').nth(0);
  await first.getByTestId('user-calculator-input-label').fill('Масса тела');
  // The name follows the label until the author chooses one.
  await expect(first.getByTestId('user-calculator-input-name')).toHaveValue('масса');
  await first.getByTestId('user-calculator-input-unit').fill('кг');
  await first.getByTestId('user-calculator-input-minimum').fill('3');
  await first.getByTestId('user-calculator-input-maximum').fill('200');

  await page.getByTestId('user-calculator-add-input').click();
  const second = page.getByTestId('user-calculator-input-card').nth(1);
  await second.getByTestId('user-calculator-input-label').fill('Рост');
  await second.getByTestId('user-calculator-input-unit').fill('см');
  await second.getByTestId('user-calculator-input-minimum').fill('40');
  await second.getByTestId('user-calculator-input-maximum').fill('220');

  const formula = page.getByTestId('user-calculator-formula');
  await formula.fill('масса / (рост / 100) ^ 2');
  await expect(page.getByTestId('user-calculator-formula-message')).toHaveText('Формула читается.');

  await page.getByTestId('user-calculator-result-label').fill('ИМТ');
  await page.getByTestId('user-calculator-result-unit').fill('кг/м²');

  await page.getByTestId('user-calculator-add-band').click();
  await page.getByTestId('user-calculator-add-band').click();
  const lower = page.getByTestId('user-calculator-band-card').nth(0);
  await lower.getByTestId('user-calculator-band-max').fill('18,4');
  await lower.getByTestId('user-calculator-band-headline').fill('Дефицит');
  await lower.getByTestId('user-calculator-band-message').fill('ИМТ ниже нормы.');
  const normal = page.getByTestId('user-calculator-band-card').nth(1);
  await normal.getByTestId('user-calculator-band-min').fill('18.5');
  await normal.getByTestId('user-calculator-band-max').fill('24.9');
  await normal.getByTestId('user-calculator-band-headline').fill('Норма');
  await normal.getByTestId('user-calculator-band-message').fill('Масса соответствует росту.');
  await waitSaved(page);
  return id;
}

test('builds a calculator, runs it, prints it, edits it, copies it, moves its inputs, exports and imports it, filters it and deletes it', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await mockPrintPopup(page);
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });

  // The calculators home has a card of its own for the list.
  await goTo(page, '#/calculators');
  const homeCard = page.getByTestId('calculator-section-custom');
  await expect(homeCard).toContainText('Пока нет своих калькуляторов');
  await homeCard.getByRole('button', { name: 'Открыть раздел «Мои калькуляторы»' }).click();
  await expect(page).toHaveURL(/#\/calculators\/mine$/u);

  const id = await createChildBmi(page);

  await page.screenshot({
    path: testInfo.outputPath('user-calculator-editor.png'),
    fullPage: true,
  });

  // The live checks: a preview on sample values, and the range tester.
  const samples = page.getByTestId('user-calculator-sample');
  await samples.nth(0).fill('49');
  await samples.nth(1).fill('170');
  await expect(page.getByTestId('user-calculator-preview-value')).toHaveText('17 кг/м²');
  await expect(page.getByTestId('user-calculator-preview-band')).toHaveText(
    'Дефицит. ИМТ ниже нормы.',
  );
  // The engine's own message for a value outside the author's limits.
  await samples.nth(1).fill('0');
  await expect(page.getByTestId('user-calculator-preview-error')).toHaveText(
    'Рост: значение меньше допустимого минимума 40.',
  );
  await samples.nth(1).fill('170');
  await page.getByTestId('user-calculator-band-test-value').fill('22,5');
  await expect(page.getByTestId('user-calculator-band-test-result')).toContainText(
    'диапазон 2 «Норма»',
  );
  await page.getByTestId('user-calculator-band-test-value').fill('24,95');
  // 24.95 is shown as 25.0 and lies between the two ranges.
  await expect(page.getByTestId('user-calculator-band-test-result')).toContainText(
    'ни один диапазон не подходит',
  );

  // A mistake in the formula is explained, and the calculator cannot be opened until it is fixed.
  const formula = page.getByTestId('user-calculator-formula');
  await formula.fill('масса / (рост / 100) ^ 2 @');
  await expect(page.getByTestId('user-calculator-formula-message')).toContainText(
    'Не понимаю символ «@» в позиции 26.',
  );
  await expect(page.getByTestId('user-calculator-editor-open')).toBeDisabled();
  await formula.fill('вес / 2');
  await expect(page.getByTestId('user-calculator-formula-message')).toContainText(
    'Нет такой переменной «вес». Доступны: масса, рост.',
  );
  await formula.fill('масса / (рост / 100) ^ 2');
  await expect(page.getByTestId('user-calculator-formula-message')).toHaveText('Формула читается.');
  await waitSaved(page);

  // Open it: the ordinary calculator screen, with the age badge and the author's wording.
  await page.getByTestId('user-calculator-editor-open').click();
  await expect(page).toHaveURL(new RegExp(`#/calculators/${id}$`, 'u'));
  await expect(page.getByRole('heading', { name: 'Индекс Кетле' })).toBeVisible();
  await expect(page.locator('.calculator-subpage-header .page__description')).toHaveText(
    'Масса тела в кг на квадратный метр роста.',
  );
  // The source has no address: it is plain text, not a link to this very page.
  await page.getByRole('button', { name: 'Источники (1)' }).click();
  await expect(page.locator('.calculator-subpage-sources__link')).toHaveText(
    'Авторский калькулятор · Создан пользователем',
  );
  await expect(page.locator('a.calculator-subpage-sources__link')).toHaveCount(0);

  await page.getByLabel('Масса тела, кг').fill('49');
  await page.getByLabel('Рост, см').fill('170');
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByText('Расчёт сохранён локально.')).toBeVisible();
  const result = page.getByTestId('calculator-result');
  await expect(result).toContainText('ИМТ');
  await expect(result).toContainText('17 кг/м²');
  await expect(result).toContainText('Дефицит. ИМТ ниже нормы.');
  await expect(result).toContainText(
    'Авторский калькулятор. Результат не заменяет клиническую оценку.',
  );
  await page.screenshot({ path: testInfo.outputPath('user-calculator-result.png') });

  // The ordinary print: inputs, formula, result, interpretation and the author's disclaimer.
  await result.getByRole('button', { name: 'Распечатать' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as PrintState).__printed)).toBe(1);
  const printed = await page.evaluate(() =>
    (window as unknown as PrintState).__printedHtml.join('\n'),
  );
  expect(printed).toContain('Индекс Кетле');
  expect(printed).toContain('Масса тела 49 кг');
  expect(printed).toContain('Рост 170 см');
  expect(printed).toContain('Формула: масса / (рост / 100) ^ 2');
  expect(printed).toContain('ИМТ: 17 кг/м²');
  expect(printed).toContain('Интерпретация:\nДефицит. ИМТ ниже нормы.');
  expect(printed).toContain('Авторский калькулятор. Результат не заменяет клиническую оценку.');

  // Edit: rename, change the formula, and the result changes.
  await page.getByTestId('calculator-edit-own').click();
  await expect(page).toHaveURL(new RegExp(`#/calculators/mine/${id}/edit$`, 'u'));
  await page.getByTestId('user-calculator-title').fill('Индекс массы');
  await page.getByTestId('user-calculator-formula').fill('масса / (рост / 100) ^ 2 + 1');
  // The preview starts from the middle of the allowed ranges: (3+200)/2 kg and (40+220)/2 cm.
  await expect(page.getByTestId('user-calculator-preview-value')).toHaveText('61,1 кг/м²');
  await page.getByTestId('user-calculator-sample').nth(0).fill('49');
  await page.getByTestId('user-calculator-sample').nth(1).fill('170');
  await expect(page.getByTestId('user-calculator-preview-value')).toHaveText('18 кг/м²');
  await waitSaved(page);

  // A field keeps its focus while the author types (the list is not rebuilt on every keystroke).
  const title = page.getByTestId('user-calculator-title');
  await title.click();
  await title.pressSequentially(' ИМТ', { delay: 30 });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Индекс массы ИМТ');
  await title.fill('Индекс массы');
  await waitSaved(page);

  // Reordering inputs reorders the form.
  await page.getByTestId('user-calculator-input-down').first().click();
  await expect(page.getByTestId('user-calculator-input-label').nth(0)).toHaveValue('Рост');
  await expect(page.getByTestId('user-calculator-input-label').nth(1)).toHaveValue('Масса тела');
  await waitSaved(page);
  await page.getByTestId('user-calculator-editor-open').click();
  await expect(page.getByRole('heading', { name: 'Индекс массы' })).toBeVisible();
  await expect(page.locator('.calculator-form__label').nth(0)).toContainText('Рост');
  await page.getByLabel('Масса тела, кг').fill('49');
  await page.getByLabel('Рост, см').fill('170');
  await page.getByTestId('calculator-submit').click();
  await expect(page.getByTestId('calculator-result')).toContainText('18 кг/м²');
  await expect(page.getByTestId('calculator-result')).toContainText('Дефицит. ИМТ ниже нормы.');

  // The list: the age badge, the input count with its plural, copy.
  await page.locator('.calculator-subpage-header').getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/#\/calculators\/mine$/u);
  const original = card(page, 'Индекс массы');
  await expect(original).toContainText('2 входных значения');
  await expect(original.locator('.tool-age-badge')).toHaveText('Дети от 2 лет');
  await expect(original.getByTestId('user-calculator-open')).toBeEnabled();
  await original.getByTestId('user-calculator-copy').click();
  await expect(page.getByText('Создана копия «Индекс массы (копия)».')).toBeVisible();
  await expect(card(page, 'Индекс массы (копия)')).toHaveCount(1);
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(2);

  await page.screenshot({ path: testInfo.outputPath('user-calculator-list.png'), fullPage: true });

  // «Взрослые» hides the children's calculators; «Все» brings them back.
  await ageFilter(page, 'Взрослые');
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(0);
  await expect(page.locator('[data-testid="tool-age-filter"]:visible')).toContainText(
    'Скрыто по возрасту: 2',
  );
  await ageFilter(page, 'Дети');
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(2);
  await ageFilter(page, 'Все');

  // Search inside the list.
  await page.getByRole('searchbox', { name: 'Найти калькулятор' }).fill('копия');
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Найти калькулятор' }).fill('');

  // Export writes a .minimed-calculator file; import brings it back as a new calculator.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    original.getByTestId('user-calculator-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe('индекс-массы.minimed-calculator');
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<
    string,
    unknown
  >;
  expect(exported).toMatchObject({
    format: 'minimed-calculator',
    version: 1,
    title: 'Индекс массы',
    formula: 'масса / (рост / 100) ^ 2 + 1',
    population: { group: 'children', minAge: { value: 2, unit: 'years' } },
  });
  const path = testInfo.outputPath('imported.minimed-calculator');
  await download.saveAs(path);
  await page.getByTestId('user-calculators-import').click();
  await page.locator('.ui-file-drop-zone__input').setInputFiles(path);
  await expect(page).toHaveURL(/#\/calculators\/mine\/uc-[a-z0-9]+\/edit$/u);
  await expect(page.getByTestId('user-calculator-title')).toHaveValue('Индекс массы');
  await page.getByTestId('user-calculator-editor-open').click();
  await expect(page.getByRole('heading', { name: 'Индекс массы' })).toBeVisible();
  await page.locator('.calculator-subpage-header').getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(3);

  // The calculators of the author are in the search catalog too, and the filter hides them there.
  await goTo(page, '#/search');
  await openHomeSection(page, 'Калькуляторы');
  const catalog = page.locator('.unified-catalog__tool-shell');
  await expect(catalog.filter({ hasText: 'Создать свой калькулятор' })).toBeVisible();
  // The author's calculators come after the built-in ones, and the grid draws only what is in view.
  await page.getByTestId('search-input').fill('Индекс массы (копия)');
  await expect(catalog.filter({ hasText: 'Индекс массы (копия)' })).toBeVisible();
  await expect(
    catalog.filter({ hasText: 'Индекс массы (копия)' }).locator('.tool-age-badge'),
  ).toHaveText('Дети от 2 лет');
  await ageFilter(page, 'Взрослые');
  await expect(catalog.filter({ hasText: 'Индекс массы (копия)' })).toHaveCount(0);
  await page.getByTestId('search-input').fill('');
  // The create card is an action: no age choice hides it.
  await expect(catalog.filter({ hasText: 'Создать свой калькулятор' })).toBeVisible();
  await ageFilter(page, 'Все');

  // Delete asks first; cancelling keeps it.
  await goTo(page, '#/calculators/mine');
  await card(page, 'Индекс массы (копия)').getByTestId('user-calculator-delete').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('«Индекс массы (копия)» будет удалён');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(3);
  await card(page, 'Индекс массы (копия)').getByTestId('user-calculator-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(card(page, 'Индекс массы (копия)')).toHaveCount(0);
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(2);

  // Everything is still there after a reload, and a deleted calculator no longer opens.
  await page.reload();
  await goTo(page, '#/calculators/mine');
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(2);
  await goTo(page, '#/calculators');
  await expect(page.getByTestId('calculator-section-custom')).toContainText('2 калькулятора');
});

test('offers to create a calculator from the search catalog and builds a draft there', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await openHomeSection(page, 'Калькуляторы');
  const create = page.getByRole('link', { name: /^Создать свой калькулятор/u });
  await expect(create).toBeVisible();
  await expect(create.locator('.tool-age-badge')).toHaveCount(0);
  await create.click();
  // `mine/new` makes the draft and continues in its editor.
  await expect(page).toHaveURL(/#\/calculators\/mine\/uc-[a-z0-9]+\/edit$/u);
  await expect(page.getByTestId('user-calculator-title')).toHaveValue('Новый калькулятор');
  await expect(page.getByTestId('user-calculator-issues')).toContainText(
    'Укажите, для кого инструмент',
  );
  await waitSaved(page);
  // A draft survives a reload and stays unfinished in the list, without being openable.
  await page.reload();
  await goTo(page, '#/calculators/mine');
  const draft = card(page, 'Новый калькулятор');
  await expect(draft).toContainText('Нет входных данных');
  await expect(draft).toContainText('Не указано, для кого калькулятор');
  await expect(draft.getByTestId('user-calculator-open')).toBeDisabled();
  // Back from the editor does not make a second draft.
  await draft.getByTestId('user-calculator-edit').click();
  await page.goBack();
  await expect(page.getByTestId('user-calculator-card')).toHaveCount(1);
});

test('refuses a file that is not a calculator and keeps the list as it was', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await goTo(page, '#/calculators/mine');
  const path = testInfo.outputPath('wrong.minimed-calculator');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, JSON.stringify({ format: 'something-else', version: 1 }));
  await page.getByTestId('user-calculators-import').click();
  await page.locator('.ui-file-drop-zone__input').setInputFiles(path);
  await expect(page.getByText(/Это не файл калькулятора MiniMed/u)).toBeVisible();
  await expect(page.getByTestId('user-calculators-empty')).toBeVisible();
});
