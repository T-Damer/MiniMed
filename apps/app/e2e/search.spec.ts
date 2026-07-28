import { expect, type Locator, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const query = 'Ребёнок часто дышит и температурит второй день';

// Routes stay mounted to preserve search state, so assertions must target the active results container
// rather than matching an identically titled document in the hidden Documents view.
function pneumoniaResult(page: Page): Locator {
  return page.getByTestId('search-results').getByText('Внебольничная пневмония у детей').first();
}

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-bottom-nav').getByRole('button', { name });
}

async function chooseScope(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('radio', { name }).click();
}

test('requires a search mode before enabling the query field', async ({ page }) => {
  await mountBuiltApp(page);

  await expect(page.getByTestId('search-input')).toBeVisible();
  await expect(page.getByTestId('search-input')).toBeDisabled();
  await expect(page.getByTestId('search-input')).toHaveAttribute(
    'placeholder',
    'Выберите режим поиска',
  );
  await chooseScope(page, /В клин\. рекомендациях/u);

  await expect(page.getByTestId('search-input')).toBeEnabled();
  await expect(page.getByTestId('search-submit')).toBeEnabled();
  await expect(page.getByRole('radio', { name: /В клин\. рекомендациях/u })).toBeChecked();
});

test('translates vertical wheel movement into horizontal mode scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);

  const modes = page.locator('.search-mode-picker');
  const viewport = page.locator('.query-shortcuts [data-overlayscrollbars-viewport]');
  const bounds = await modes.boundingBox();
  if (!bounds) throw new Error('Search modes are not visible.');
  await page.mouse.move(bounds.x + 8, bounds.y + 4);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test('finds a recommendation section and opens local context', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /В клин\. рекомендациях/u);
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();
  await expect(page.getByTestId('search-mode')).toHaveText('FTS5 + VECTOR');
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await pneumoniaResult(page).click();
  await page.getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toContainText('Внебольничная пневмония у детей');
  await expect(page.getByTestId('reader-context')).toContainText('тахипноэ');
});

test('limits medication mode to medication documents', async ({ page }) => {
  await mountBuiltApp(page);

  await chooseScope(page, /Препараты/u);
  await page.getByTestId('search-input').fill('цефтриаксон');
  await expect(page.locator('.result-group').first()).toContainText(/Цефтриаксон/u, {
    timeout: 10_000,
  });
  await expect(page.getByTestId('search-results')).not.toContainText(
    'Внебольничная пневмония у детей',
  );
});

test('limits the initial document list and reveals remaining sources', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();

  const groups = page.locator('.result-group');
  await expect(groups).toHaveCount(5);
  const showMore = page.getByRole('button', { name: /Показать ещё/u });
  await expect(showMore).toHaveAttribute('aria-expanded', 'false');
  await showMore.click();
  await expect(page.getByRole('button', { name: 'Скрыть остальные документы' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('preserves the active search while navigating between mounted routes', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();

  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('heading', { name: 'База знаний и модель' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Документы/u })).toBeVisible();
  await navigationButton(page, 'Поиск').click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('shows the doctor-facing knowledge-base catalog', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'База знаний').click();

  await expect(page.getByRole('heading', { name: 'База знаний и модель' })).toBeVisible();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Всегда доступно/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /Клиническая педиатрия/u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Лекарства, документы и нормы/u })).toBeVisible();
  await expect(page.getByRole('button', { name: /Клинические рекомендации/u })).toBeVisible();
  await page.getByRole('button', { name: /Клинические рекомендации/u }).click();
  await expect(page).toHaveURL(/#\/modules\/documents\/recommendations/u);
  await expect(page.getByRole('button', { name: /^Инфекционные болезни/u })).toBeVisible();
  await expect(page.locator('.recommendation-section-card')).toHaveCount(21);
  await expect(page.getByText('Обновление списка наборов')).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Всегда доступно/u }).click();
  await expect(page.getByText('Ядро MiniMed')).toBeVisible();
});

test('replays a saved query from the history drawer', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();

  await chooseScope(page, /Препараты/u);

  // History now lives behind a floating button so the search view stays compact.
  await page.getByRole('button', { name: 'Показать историю поиска' }).click();
  const historyEntry = page
    .locator('.search-history-panel-replay')
    .filter({ hasText: query })
    .first();
  await expect(historyEntry).toBeVisible();
  await page.getByTestId('search-input').fill('другой запрос');
  await historyEntry.click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(page.getByRole('radio', { name: /Всё без диагностики/u })).toBeChecked();
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('runs a debounced clinical search without requiring submit', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
});

test('autosearch leaves the typed text untouched, including trailing space', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  // The debounced search used to write the trimmed query back into the field, deleting the space a
  // doctor had just typed mid-sentence.
  await page.getByTestId('search-input').fill(`${query} `);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('search-input')).toHaveValue(`${query} `);
});

test('filters the document library and opens a document with one click', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'База знаний').click();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await page.getByRole('button', { name: /Всегда доступно/u }).click();
  await page.getByRole('button', { name: 'Открыть документы ядра' }).click();
  await page.getByPlaceholder('Название, специальность или источник').fill('пневмония');
  await page.getByRole('button', { name: /Внебольничная пневмония/u }).click();
  await expect(page.getByRole('heading', { name: 'Пневмония у детей', level: 2 })).toBeVisible();
  await expect(page.getByLabel('Поиск в документе')).toBeVisible();
});

test('opens only the exact fragment first and expands surrounding source context', async ({
  page,
}) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
  await pneumoniaResult(page).click();
  await page.getByTestId('search-result').first().click();
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать текст вокруг' }).click();
  expect(await page.locator('.source-paragraph').count()).toBeGreaterThan(1);
});

test('shows neuroinfection clarifications without hiding search results', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Диагностировать/u);
  await page.getByTestId('search-input').fill('Менингит или энцефалит у ребёнка');
  await expect(page.getByRole('button', { name: /Сознание и судороги/u })).toBeVisible();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 3_000 });
});

test('asks before activating an installed application update', async ({ page }) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    const worker = {
      postMessage: (message: unknown) => {
        (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage = message;
      },
    };
    window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
  });

  const update = page.getByRole('button', { name: 'Обновить приложение' });
  await expect(update).toBeVisible();
  await update.click();
  await expect(page.getByRole('button', { name: 'Обновляем приложение…' })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage,
      ),
    )
    .toEqual({ type: 'SKIP_WAITING' });
});
