import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('stretches calculator cards across a narrow single-column grid', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 });
  await mountBuiltApp(page, { persistentOrigin: true });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();

  const dimensions = await page.locator('.calculator-catalog-grid').evaluate((grid) => {
    const card = grid.querySelector<HTMLElement>('.calculator-card');
    if (!card) throw new Error('calculator card missing');
    return {
      grid: grid.getBoundingClientRect().width,
      card: card.getBoundingClientRect().width,
    };
  });

  expect(dimensions.card).toBeCloseTo(dimensions.grid, 0);
});

test('offers and installs the pediatric growth pack from the calculator catalog', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();

  const anthropometry = page.getByTestId('calculator-section-anthropometry');
  // The section names the download and its size; module titles live in the downloads page.
  await expect(anthropometry).toContainText(/Скачать раздел · [\d.,]+\s[КМ]Б/u);
  await anthropometry.getByRole('button', { name: 'Скачать раздел — Антропометрия' }).click();
  await expect(anthropometry).not.toContainText('Скачать раздел ·');
  // One notice turns from progress into the result: no stale «Скачиваем модуль…» beside it.
  await expect(page.getByText(/«Антропометрия» скачан/u)).toBeVisible();
  await expect(page.getByText('Скачиваем модуль…')).toHaveCount(0);

  await anthropometry.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
  await expect(
    page.getByRole('heading', { name: 'Антропометрия детей: z-score и перцентили ВОЗ' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Открыть «Антропометрия детей: z-score и перцентили ВОЗ»',
    })
    .click();
  await expect(page).toHaveURL(/#\/calculators\/pediatric-anthropometry-who$/u);

  const submit = page.getByTestId('calculator-submit');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Дата рождения').fill('2026-01-01');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Масса тела, г').fill('7500');
  await expect(submit).toBeEnabled();

  const tooltipButton = page.getByRole('button', {
    name: 'Подсказка: Метод измерения длины/роста',
  });
  await tooltipButton.click();
  await page.getByLabel('Дата рождения').click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await tooltipButton.click();
  await expect(page.getByRole('tooltip')).toContainText('до 2 лет');
  await expect(page.getByLabel('Масса тела, г')).toBeVisible();
});

test('calculates body surface area and writes the result to a patient note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await expect(page.locator('.calculator-launch-button')).toHaveCount(0);
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/calculators$/u);
  await expect(page.getByRole('heading', { name: 'Калькуляторы', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
  const anthropometryDownload = page.getByRole('button', {
    // «Скачать раздел», «Скачать дополнения» or «Есть обновление», then the section title.
    name: /^(Скачать раздел|Скачать дополнения|Есть обновление) — Антропометрия$/u,
  });
  const openMosteller = page.getByTestId('calculator-open-body-surface-area-mosteller');
  await expect(anthropometryDownload.or(openMosteller).first()).toBeVisible();
  if (await anthropometryDownload.isVisible()) await anthropometryDownload.click();
  await openMosteller.click();
  await expect(
    page.getByRole('heading', { name: 'Площадь поверхности тела — Mosteller' }),
  ).toBeVisible();

  await page
    .getByRole('combobox', { name: 'Пациент / случай — необязательно', exact: true })
    .fill('Пациент калькулятора');
  await page.getByLabel('Рост, см').fill('170');
  await page.getByLabel('Масса, кг').fill('70');
  await page.getByTestId('calculator-submit').click();

  await expect(page.getByText('Расчёт сохранён локально.')).toBeVisible();
  await expect(page.getByTestId('calculator-result')).toContainText('1,82 м²');

  await page.getByTestId('calculator-save-note').click();
  await page.getByRole('button', { name: 'Записать результат' }).click();
  await expect(page.getByText('Расчёт записан в карточку пациента.')).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Пациент калькулятора' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('Площадь поверхности тела');
  await expect(page.locator('.patient-note-record')).toContainText('1,82 м²');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('Площадь поверхности тела', {
    timeout: 25_000,
  });
});

test('a link to an unknown tool says so above the calculator list', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await page.evaluate(() => {
    window.location.hash = '#/calculators/no-such-tool';
  });
  await expect(page.locator('.calculators-heading__missing')).toContainText(
    'Инструмент по этой ссылке не найден',
  );
  await expect(page.getByRole('heading', { name: 'Калькуляторы', exact: true })).toBeVisible();
});
