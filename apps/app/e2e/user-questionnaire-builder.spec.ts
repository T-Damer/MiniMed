import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const SCREENSHOTS = process.env['TOOLS1_SCREENSHOTS'];

/** Captures what the print window receives instead of opening one. */
async function capturePrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const printed: string[] = [];
    (window as unknown as { __printed: string[] }).__printed = printed;
    window.open = () =>
      ({
        opener: null,
        document: {
          images: [],
          open: () => undefined,
          write: (html: string) => {
            printed.push(html);
          },
          close: () => undefined,
        },
        focus: () => undefined,
        print: () => undefined,
        close: () => undefined,
      }) as unknown as Window;
  });
}

async function printed(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
}

async function openBuilder(page: Page): Promise<void> {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/assessments/mine';
  });
  await page
    .locator('.assessment-user-questionnaires__search-chrome')
    .getByRole('button', { name: 'Создать опросник' })
    .click();
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+\/edit$/u);
  await expect(page.getByTestId('questionnaire-title')).toBeVisible();
}

async function chooseAge(page: Page, label: 'Дети' | 'Взрослые' | 'Любой возраст'): Promise<void> {
  await page.getByTestId('tool-population').getByText(label, { exact: true }).click();
}

/** The weight fields of the first question: «Нет» and «Да». */
async function scoreQuestion(page: Page, index: number, no: string, yes: string): Promise<void> {
  const card = page.getByTestId('questionnaire-question').nth(index);
  await card.getByLabel('Баллы').nth(0).fill(no);
  await card.getByLabel('Баллы').nth(1).fill(yes);
}

test('keeps every typed character, spaces included, while the draft saves', async ({ page }) => {
  await openBuilder(page);
  const title = page.getByTestId('questionnaire-title');
  await title.fill('');
  await title.pressSequentially('Шкала тревоги и депрессии ', { delay: 25 });
  await title.pressSequentially('для приёма', { delay: 25 });
  await expect(title).toHaveValue('Шкала тревоги и депрессии для приёма');
  const description = page.getByTestId('questionnaire-description');
  await description.pressSequentially('Первая строка ', { delay: 20 });
  await description.pressSequentially('и вторая', { delay: 20 });
  await expect(description).toHaveValue('Первая строка и вторая');
  await expect(page.getByTestId('questionnaire-save-state')).toHaveText('Все изменения сохранены');
});

test('asks who the questionnaire is for before it can run and says what to fix', async ({
  page,
}) => {
  await openBuilder(page);
  await expect(page.getByTestId('questionnaire-run')).toBeDisabled();
  const issues = page.getByTestId('questionnaire-issues');
  await expect(issues).toContainText(
    'Укажите, для кого инструмент: дети, взрослые или любой возраст.',
  );
  await chooseAge(page, 'Дети');
  await page.getByTestId('tool-population-min-value').fill('2');
  await page.getByTestId('tool-population-max-value').fill('1');
  await expect(page.getByTestId('tool-population')).toContainText(
    'Нижняя граница возраста больше верхней',
  );
  await page.getByTestId('tool-population-max-value').fill('12');
  await expect(page.getByTestId('tool-population')).not.toContainText(
    'Нижняя граница возраста больше',
  );
  await expect(page.getByTestId('questionnaire-run')).toBeEnabled();
});

test('builds a sectioned, scored questionnaire with ranges, runs it and prints it', async ({
  page,
}) => {
  await capturePrints(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBuilder(page);
  const run = page.getByTestId('questionnaire-run');

  await page.getByTestId('questionnaire-title').fill('Тревога и депрессия');
  await chooseAge(page, 'Взрослые');

  // Two sections, one question each, moved from «без раздела» into their sections.
  await page.getByTestId('questionnaire-add-section').click();
  await page.getByTestId('questionnaire-add-section').click();
  const sections = page.getByTestId('questionnaire-section');
  await expect(sections).toHaveCount(2);
  await sections.nth(0).getByTestId('questionnaire-section-title').fill('Тревога');
  await sections.nth(1).getByTestId('questionnaire-section-title').fill('Депрессия');

  const first = page.getByTestId('questionnaire-question').first();
  await first.getByLabel('Формулировка').fill('Чувствую напряжение');
  await first.getByLabel('Раздел').selectOption({ label: 'Тревога' });
  await scoreQuestion(page, 0, '0', '2');

  await sections.nth(1).getByRole('button', { name: 'Добавить вопрос в раздел' }).click();
  const second = sections.nth(1).getByTestId('questionnaire-question').first();
  await second.getByLabel('Формулировка').fill('Потерял интерес к делам');
  const secondCard = second.getByLabel('Баллы');
  await secondCard.nth(0).fill('0');
  await secondCard.nth(1).fill('3');
  await expect(run).toBeEnabled();

  // A section's own score and its ranges.
  const bands = page.getByTestId('questionnaire-bands');
  await page.getByLabel('Считать баллы отдельно по разделам').check({ force: true });
  const scopes = bands.getByTestId('questionnaire-bands-scope');
  await expect(scopes).toHaveCount(2);
  await scopes.nth(0).getByTestId('questionnaire-band-add').click();
  await scopes.nth(0).getByTestId('band-headline').fill('Норма');
  await scopes.nth(0).getByTestId('band-min').fill('0');
  await scopes.nth(0).getByTestId('band-max').fill('0');
  await scopes.nth(0).getByTestId('questionnaire-band-add').click();
  await scopes.nth(0).getByTestId('band-headline').nth(1).fill('Тревога повышена');
  await scopes.nth(0).getByTestId('band-message').nth(1).fill('Обсудите с врачом.');
  await scopes.nth(1).getByTestId('questionnaire-band-add').click();
  await scopes.nth(1).getByTestId('band-headline').fill('Норма');
  await scopes.nth(1).getByTestId('band-max').fill('3');

  // The score check tells which range a score falls into.
  await scopes.nth(0).getByLabel('Проверить балл').fill('2');
  await expect(scopes.nth(0)).toContainText('Результат: «Тревога повышена»');
  if (SCREENSHOTS)
    await page.screenshot({
      path: `${SCREENSHOTS}/questionnaire-editor-1280-light.png`,
      fullPage: true,
    });

  await expect(page.getByTestId('questionnaire-save-state')).toHaveText('Все изменения сохранены');

  // The blank prints with its section headings.
  await page.getByTestId('questionnaire-print').click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const blank = (await printed(page))[0] ?? '';
  expect(blank).toContain('Тревога');
  expect(blank).toContain('Депрессия');
  expect(blank).toContain('Чувствую напряжение');

  // Run it: answers → section results with their own explanation.
  await run.click();
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+$/u);
  await expect(page.getByRole('heading', { name: 'Тревога', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Депрессия', level: 2 })).toBeVisible();
  await page.locator('.assessment-response-options__option', { hasText: 'Да' }).first().click();
  await page.locator('.assessment-response-options__option', { hasText: 'Нет' }).last().click();
  await page.getByTestId('assessment-submit').click();
  await expect(page.getByText('Результаты по разделам')).toBeVisible();
  await expect(page.locator('.assessment-result-summary__text')).toContainText(
    'Тревога: Тревога повышена. Обсудите с врачом.',
  );
  await expect(page.locator('.assessment-result-summary__text')).toContainText('Депрессия: Норма');
});

test('says in plain Russian why ranges overlap and what a score check finds', async ({ page }) => {
  await openBuilder(page);
  await chooseAge(page, 'Любой возраст');
  await scoreQuestion(page, 0, '0', '4');
  const bands = page.getByTestId('questionnaire-bands');
  await bands.getByTestId('questionnaire-band-add').click();
  await bands.getByTestId('band-headline').fill('Низкий');
  await bands.getByTestId('band-max').fill('3');
  await bands.getByTestId('questionnaire-band-add').click();
  await bands.getByTestId('band-headline').nth(1).fill('Высокий');
  await bands.getByTestId('band-min').nth(1).fill('3');
  await bands.getByTestId('band-max').nth(1).fill('4');
  await expect(page.getByTestId('questionnaire-issues')).toContainText('пересекаются');
  await expect(page.getByTestId('questionnaire-run')).toBeDisabled();
  await bands.getByTestId('band-min').nth(1).fill('4');
  await expect(page.getByTestId('questionnaire-issues')).toHaveCount(0);
  await expect(page.getByTestId('questionnaire-run')).toBeEnabled();
});

test('reorders, duplicates and deletes questions and sections', async ({ page }) => {
  await openBuilder(page);
  await chooseAge(page, 'Дети');
  await page.getByTestId('questionnaire-add-question').click();
  await page.getByTestId('questionnaire-add-question').click();
  const cards = page.getByTestId('questionnaire-question');
  await expect(cards).toHaveCount(3);
  await cards.nth(0).getByLabel('Формулировка').fill('Первый');
  await cards.nth(1).getByLabel('Формулировка').fill('Второй');
  await cards.nth(2).getByLabel('Формулировка').fill('Третий');
  await cards.nth(2).getByRole('button', { name: 'Поднять вопрос 3 выше' }).click();
  await expect(cards.nth(1).getByLabel('Формулировка')).toHaveValue('Третий');
  await expect(cards.nth(2).getByLabel('Формулировка')).toHaveValue('Второй');
  await cards.nth(0).getByRole('button', { name: 'Копировать вопрос 1' }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(1).getByLabel('Формулировка')).toHaveValue('Первый');
  await cards.nth(3).getByRole('button', { name: 'Удалить вопрос 4' }).click();
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Вопрос 3' })).toBeVisible();
});

test('duplicates, exports, imports and deletes a questionnaire', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('questionnaire-title').fill('Для копирования');
  await chooseAge(page, 'Взрослые');
  await expect(page.getByTestId('questionnaire-save-state')).toHaveText('Все изменения сохранены');

  // Export downloads a file that round-trips through import.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('questionnaire-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe('Для копирования.minimed-questionnaire');
  const path = await download.path();
  const exported = JSON.parse(await readFile(path, 'utf8')) as {
    version: number;
    population: { group: string };
  };
  expect(exported.version).toBe(2);
  expect(exported.population.group).toBe('adults');

  // A copy opens for editing under its own name.
  await page.getByTestId('questionnaire-duplicate').click();
  await expect(page.getByTestId('questionnaire-title')).toHaveValue('Для копирования (копия)');

  // The list shows both, with the age badge of each.
  await page.evaluate(() => {
    window.location.hash = '#/assessments/mine';
  });
  await expect(page.locator('.assessment-user-questionnaire')).toHaveCount(3);
  const copy = page.locator('.assessment-user-questionnaire', {
    hasText: 'Для копирования (копия)',
  });
  await expect(copy.locator('.tool-age-badge')).toHaveText('Взрослые');

  // Import the exported file.
  await page.getByRole('button', { name: 'Импортировать опросник' }).click();
  await page.locator('.ui-file-drop-zone__input').setInputFiles({
    name: 'Для копирования.minimed-questionnaire',
    mimeType: 'application/json',
    buffer: await readFile(path),
  });
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+\/edit$/u);
  await expect(page.getByTestId('questionnaire-title')).toHaveValue(/Для копирования/u);

  // Delete from the editor, after a confirmation.
  await page.getByTestId('questionnaire-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page).toHaveURL(/#\/assessments\/mine$/u);
  await expect(page.locator('.assessment-user-questionnaire')).toHaveCount(3);
});

test('an imported file without a population opens for editing but cannot run yet', async ({
  page,
}) => {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/assessments/mine';
  });
  await page.getByRole('button', { name: 'Импортировать опросник' }).click();
  await page.locator('.ui-file-drop-zone__input').setInputFiles({
    name: 'старый.minimed-questionnaire',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'minimed-questionnaire',
        version: 1,
        title: 'Старый опросник',
        questions: [
          {
            prompt: 'Вопрос',
            options: [
              { label: 'Нет', weight: 0 },
              { label: 'Да', weight: 1 },
            ],
          },
        ],
      }),
    ),
  });
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+\/edit$/u);
  await expect(page.getByTestId('questionnaire-run')).toBeDisabled();
  await expect(page.getByTestId('questionnaire-issues')).toContainText(
    'Укажите, для кого инструмент',
  );
});
