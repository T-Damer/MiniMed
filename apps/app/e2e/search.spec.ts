import { expect, type Locator, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, hasLocalCompanionPack, mountBuiltApp } from './mount-built-app';

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
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
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
  test.skip(
    !hasLocalCompanionPack('medications.db'),
    'The full medication companion pack is local-only.',
  );
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });

  await chooseScope(page, /Препараты/u);
  await page.getByTestId('search-input').fill('цефтриаксон');
  await expect(page.locator('.result-group').first()).toContainText(/Цефтриаксон/u, {
    timeout: 10_000,
  });
  await expect(page.getByTestId('search-results')).not.toContainText(
    'Внебольничная пневмония у детей',
  );
});

test('opens Miramistin indications from the full instruction with structured lists', async ({
  page,
}) => {
  test.skip(
    !hasLocalCompanionPack('medications.db'),
    'The full medication companion pack is local-only.',
  );
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });
  await chooseScope(page, /Препараты/u);
  await page.getByTestId('search-input').fill('Мирамистин показания');
  const instructionResult = page
    .locator('.result-group')
    .filter({ hasText: 'Мирамистин 0,01%: инструкция по медицинскому применению' });
  const instructionAvailable = await expect
    .poll(() => instructionResult.count(), { timeout: 10_000 })
    .toBeGreaterThan(0)
    .then(
      () => true,
      () => false,
    );
  test.skip(
    !instructionAvailable,
    'The local medication pack does not include the selected full instruction.',
  );
  await expect(instructionResult).toBeVisible();

  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/medications/${encodeURIComponent(
      'ЛП-№(005744)-(РГ-RU)',
    )}`,
  );
  await expect(
    page.locator('.document-page__chrome > .document-overlay-outline-toggle'),
  ).toBeVisible({ timeout: 30_000 });

  const indications = page
    .locator('.document-overlay-section')
    .filter({ has: page.getByRole('heading', { name: 'Показания к применению', level: 2 }) });
  await expect(indications.locator('ul > li')).toHaveCount(8);
  const contents = page
    .locator('.document-overlay-section')
    .filter({ has: page.getByRole('heading', { name: 'Содержание листка-вкладыша', level: 2 }) });
  await expect(contents.locator('ol > li')).toHaveCount(6);

  const application = page.getByRole('heading', {
    name: '3. Применение препарата Мирамистин®',
    level: 2,
  });
  await application.evaluate((heading) =>
    heading.closest('section')?.scrollIntoView({ block: 'start' }),
  );
  const activeOutlineItem = page
    .getByRole('navigation', { name: 'Разделы документа' })
    .getByRole('button', { name: /08 3\. Применение препарата/u });
  await expect(activeOutlineItem).toHaveAttribute('aria-current', 'location');
  await expect
    .poll(() =>
      activeOutlineItem.evaluate((item) => {
        const outline = item.closest('.document-overlay-outline');
        if (!outline) return Number.POSITIVE_INFINITY;
        const itemRect = item.getBoundingClientRect();
        const outlineRect = outline.getBoundingClientRect();
        return Math.abs(
          itemRect.top + itemRect.height / 2 - (outlineRect.top + outlineRect.height / 2),
        );
      }),
    )
    .toBeLessThan(8);
});

test('toggles the document outline on desktop and highlights exact reader matches', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await chooseScope(page, /В клин\. рекомендациях/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();
  await pneumoniaResult(page).click();
  await page.getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть полный документ' }).click();

  const overlay = page.locator('.document-overlay');
  const outline = overlay.locator('.document-overlay-outline');
  const toggle = overlay.locator('.document-overlay-outline-toggle');
  await expect(outline).toBeVisible();
  await toggle.click();
  await expect(outline).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay.locator('.document-overlay-layout')).toHaveClass(
    /document-overlay-layout--outline-hidden/u,
  );
  await page.screenshot({ path: '.omo/evidence/document-overlay/reader-1280-toc-hidden.png' });
  await toggle.click();
  await expect(outline).toBeVisible();
  await page.screenshot({ path: '.omo/evidence/document-overlay/reader-1280-toc-visible.png' });

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(outline).toBeVisible();
  await page.screenshot({ path: '.omo/evidence/document-overlay/reader-768.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(outline).toBeVisible();
  await page.screenshot({ path: '.omo/evidence/document-overlay/reader-375.png' });
  await outline.getByRole('button', { name: 'Закрыть оглавление' }).click();
  await expect(outline).not.toHaveClass(/document-overlay-outline--open/u);
  await page.screenshot({ path: '.omo/evidence/document-overlay/reader-375-closed.png' });
  await toggle.click();
  await expect(outline).toHaveClass(/document-overlay-outline--open/u);

  await overlay.getByRole('button', { name: 'Поиск в документе' }).click();
  await overlay.getByRole('searchbox', { name: 'Поиск в документе' }).fill('тахипноэ');
  await expect(overlay.locator('mark').first()).toBeVisible({ timeout: 3000 });
  await expect(overlay.locator('mark').first()).toHaveText(/тахипноэ/iu);
  await expect(overlay.getByText(/\d+\s*\/\s*\d+/)).toBeVisible();
});

test('renders the complete virtualized document list', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();

  const groups = page.locator('.result-group');
  await expect(groups).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Показать ещё/u })).toHaveCount(0);
});

test('preserves the active search while navigating between mounted routes', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();

  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();
  await navigationButton(page, 'Поиск').click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('returns to the documents route after opening a questionnaire', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });

  await page.evaluate(() => {
    window.location.hash = '#/modules/documents';
  });
  await expect(page).toHaveURL(/#\/modules\/documents$/u);
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = '#/assessments/braverman-behavioral-profile';
  });
  await expect(page).toHaveURL(/#\/assessments\/braverman-behavioral-profile$/u);
  await expect(
    page.getByRole('heading', { name: 'Тест Бравермана — поведенческий профиль' }),
  ).toBeVisible();

  await navigationButton(page, 'База знаний').click();
  await expect(page).toHaveURL(/#\/modules\/documents$/u);
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();
});

test('queues rapid primary navigation without blocking the bottom bar', async ({ page }) => {
  await mountBuiltApp(page);

  const clickPosition = async (name: string): Promise<{ x: number; y: number }> => {
    const bounds = await navigationButton(page, name).boundingBox();
    if (!bounds) throw new Error(`Navigation button is not visible: ${name}`);
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  };
  const modules = await clickPosition('База знаний');
  const notes = await clickPosition('Заметки');
  const search = await clickPosition('Поиск');

  await page.mouse.click(modules.x, modules.y);
  await page.waitForTimeout(35);
  await page.mouse.click(notes.x, notes.y);
  await page.waitForTimeout(35);
  await page.mouse.click(search.x, search.y);

  await expect(page).toHaveURL(/#\/search$/u, { timeout: 3_000 });
  await expect(navigationButton(page, 'Поиск')).toHaveClass(/active/u);
  await expect(page.locator('html')).not.toHaveClass(/using-root-view-transition/u);
});

test('swipes the bottom navigation to another section', async ({ page }) => {
  await mountBuiltApp(page);

  const from = await navigationButton(page, 'Поиск').boundingBox();
  const to = await navigationButton(page, 'Заметки').boundingBox();
  if (!from || !to) throw new Error('Bottom navigation buttons are not visible.');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('.app-bottom-nav')).toHaveClass(/app-bottom-nav--dragging/u);
  await page.mouse.up();

  await expect(page).toHaveURL(/#\/notes$/u);
  await expect(navigationButton(page, 'Заметки')).toHaveAttribute('aria-current', 'page');
});

test('finishes a swipe released outside the bottom navigation', async ({ page }) => {
  await mountBuiltApp(page);

  const nav = page.locator('.app-bottom-nav');
  const from = await navigationButton(page, 'Поиск').boundingBox();
  const navBounds = await nav.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  if (!from || !navBounds) throw new Error('Bottom navigation is not visible.');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    Math.min(viewport.width - 4, navBounds.x + navBounds.width + 180),
    from.y + from.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page).toHaveURL(/#\/notes$/u);
  await expect(nav).not.toHaveClass(/app-bottom-nav--dragging/u);
});

test('shows the doctor-facing knowledge-base catalog', async ({ page }) => {
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });
  await navigationButton(page, 'База знаний').click();

  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Клиническая педиатрия/u })).toHaveCount(0);
  await expect(page.locator('article[aria-label="Открыть набор «Лекарства»"]')).toBeVisible();
  await expect(page.locator('article[aria-label="Открыть набор «Нормы и расчёты»"]')).toBeVisible();
  await expect(
    page.locator('article[aria-label="Открыть набор «Законы и нормативные акты»"]'),
  ).toBeVisible();
  await expect(page.locator('article[aria-label="Открыть набор «Ядро»"]')).toBeVisible();
  await expect(
    page.locator('article[aria-label="Открыть набор «Клинические рекомендации»"]'),
  ).toBeVisible();
  await page.locator('article[aria-label="Открыть набор «Клинические рекомендации»"]').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/recommendations/u);
  await expect(
    page.locator('article[aria-label="Открыть раздел «Инфекционные болезни и эпидемиология»"]'),
  ).toBeVisible();
  await expect(page.locator('.recommendation-section-card')).toHaveCount(21);
  await expect(page.getByText('Обновление списка наборов')).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.locator('article[aria-label="Открыть набор «Ядро»"]').click();
  await expect(page.getByRole('heading', { name: /встроенных документов/u })).toBeVisible();
});

test('replays a saved query from the history drawer', async ({ page }) => {
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });
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
  await page.locator('article[aria-label="Открыть набор «Ядро»"]').click();
  await page.getByRole('button', { name: /Внебольничная пневмония/u }).click();
  await expect(page.getByRole('heading', { name: 'Пневмония у детей', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поиск в документе' })).toBeVisible();
});

test('opens only the exact fragment without surrounding source context', async ({ page }) => {
  await mountBuiltApp(page);
  await chooseScope(page, /Всё без диагностики/u);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 3_000 });
  await pneumoniaResult(page).click();
  await page.getByTestId('search-result').first().click();
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Показать текст вокруг' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Открыть полный документ' })).toBeVisible();
  await expect(page.locator('.reader-toolbar')).toHaveCount(0);
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

  const update = page.locator('.search-update-status');
  await expect(update).toBeVisible();
  await update.click();
  await expect(update).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage,
      ),
    )
    .toEqual({ type: 'SKIP_WAITING' });
});
