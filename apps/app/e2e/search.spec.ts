import { expect, type Locator, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const query = 'Ребёнок часто дышит и температурит второй день';

// Routes stay mounted to preserve search state, so assertions must target the active results container
// rather than matching an identically titled document in the hidden Documents view.
function pneumoniaResult(page: Page): Locator {
  return page.getByTestId('search-results').getByText('Внебольничная пневмония у детей').first();
}

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-nav-icons').getByRole('button', { name, exact: true });
}

test('finds a recommendation section and opens local context', async ({ page }) => {
  await mountBuiltApp(page);
  await expect(page.getByText('Что нужно найти?')).toBeVisible();
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();
  await expect(page.getByTestId('search-mode')).toHaveText('FTS5 + VECTOR');
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await page.getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toContainText('Клиническая картина');
  await expect(page.getByTestId('reader-context')).toContainText('тахипноэ');
});

test('preserves the active search while navigating between mounted routes', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();

  await navigationButton(page, 'Документы').click();
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  await navigationButton(page, 'Поиск').click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('shows the doctor-facing knowledge-base catalog', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'База знаний').click();

  await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible();
  await expect(page.getByText('Ядро MiniMed')).toBeVisible();
  await expect(page.getByText('Педиатрия: инфекционные болезни')).toBeVisible();
  await expect(page.getByText('Лекарственные препараты РФ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пока недоступно' }).first()).toBeDisabled();
  await page.getByText('Обновление списка наборов').click();
  await expect(page.getByText(/Текущий встроенный пакет:/u)).toBeVisible();
});

test('replays a saved query from local search history', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();

  await navigationButton(page, 'История').click();
  await expect(page.getByRole('heading', { name: 'История поиска' })).toBeVisible();
  const historyEntry = page.locator('.history-replay').filter({ hasText: query }).first();
  await expect(historyEntry).toBeVisible();
  await historyEntry.click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('runs a debounced clinical search without requiring submit', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
});

test('filters the document library and opens a document with one click', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'Документы').click();
  await page.getByPlaceholder('Название, специальность или источник').fill('пневмония');
  await page.getByRole('button', { name: /Внебольничная пневмония/u }).click();
  await expect(
    page.getByRole('heading', { name: 'Внебольничная пневмония у детей' }),
  ).toBeVisible();
  await expect(page.getByLabel('Поиск в документе')).toBeVisible();
});

test('opens only the exact fragment first and expands surrounding source context', async ({
  page,
}) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
  await page.getByTestId('search-result').first().click();
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать текст вокруг' }).click();
  expect(await page.locator('.source-paragraph').count()).toBeGreaterThan(1);
});

test('shows neuroinfection clarifications without hiding search results', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill('Менингит или энцефалит у ребёнка');
  await expect(page.getByRole('button', { name: /Сознание и судороги/u })).toBeVisible();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 3_000 });
});
