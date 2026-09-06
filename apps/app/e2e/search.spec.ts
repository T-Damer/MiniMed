import { expect, type Locator, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, hasLocalCompanionPack, mountBuiltApp } from './mount-built-app';

const query = 'пневмония';

// Routes stay mounted to preserve search state, so assertions must target the active results container
// rather than matching an identically titled document in the hidden Documents view.
function pneumoniaResult(page: Page): Locator {
  return page
    .getByTestId('search-results')
    .getByText(/Пневмония/u)
    .first();
}

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-bottom-nav').getByRole('button', { name });
}

test('opens with free search ready', async ({ page }) => {
  await mountBuiltApp(page);

  await expect(page.getByTestId('search-input')).toBeVisible();
  await expect(page.getByTestId('search-input')).toBeEnabled();
  await expect(page.getByTestId('search-submit')).toBeEnabled();
  await expect(page.locator('.search-mode-picker--single')).toHaveText('Свободный поиск');
  await expect(page.getByRole('radio')).toHaveCount(0);
});

test('runs a selected calculator inline without leaving search', async ({ page }) => {
  await mountBuiltApp(page);

  await page.getByRole('button', { name: 'Выбрать калькулятор' }).click();
  await page.getByRole('option', { name: /^Единицы/u }).click();

  await expect(page.locator('.search-inline-calculator')).toBeVisible();
  await expect(page.locator('.calculator-form--inline')).toBeVisible();
  await expect(page).not.toHaveURL(/#\/calculators\//u);

  await page.getByRole('spinbutton', { name: 'Значение' }).fill('2');
  await page.getByRole('combobox', { name: 'В единицу' }).selectOption('g');
  await page.getByRole('button', { name: 'Рассчитать и сохранить' }).click();

  await expect(page.getByTestId('calculator-result')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Распечатать' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поделиться' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/calculators\//u);
});

test('keeps the calculator picker clear of the search text', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await mountBuiltApp(page);

  const input = page.getByTestId('search-input');
  await input.fill('Лечение аллергии ребёнку 15 лет\nЖаропонижающее ребёнку 4 лет\n@');
  const menu = page.locator('.search-tool-picker__menu');
  await expect(menu).toBeVisible();

  const inputBox = await input.boundingBox();
  const menuBox = await menu.boundingBox();
  if (!inputBox || !menuBox) throw new Error('Search picker geometry is unavailable.');
  expect(
    menuBox.y >= inputBox.y + inputBox.height || menuBox.y + menuBox.height <= inputBox.y,
  ).toBe(true);
});

test('keeps an inline document preview inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/cmVmZXJlbmNlLndoby5jaGlsZC1ncm93dGgtMC0xOQ`,
  );

  const link = page.locator('.document-inline-preview').first();
  await link.scrollIntoViewIfNeeded();
  await link.getByRole('button').first().click();
  const card = page.locator('.document-inline-preview__card');
  await expect(card).toBeVisible();

  const box = await card.boundingBox();
  if (!box) throw new Error('Document preview geometry is unavailable.');
  expect(box.y).toBeGreaterThanOrEqual(0);
  const nav = await page.locator('.app-bottom-nav').boundingBox();
  if (!nav) throw new Error('App navigation geometry is unavailable.');
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y - 7);
  const header = page.locator('.document-inline-preview__header');
  expect(await header.evaluate((node) => getComputedStyle(node).position)).toBe('sticky');
  await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
  await expect(card).toHaveCount(0);
});

test('opens a document tool in a route-owned window even when mini-windows are disabled', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const documentRoute =
    '#/modules/documents/d/cmVmZXJlbmNlLm1pbmltZWQuYXNzZXNzbWVudC50ZWFtLXJvbGVz';
  await page.evaluate(() => {
    window.location.hash = '#/assessments/psychology';
  });
  await expect(page.getByText('Командные роли', { exact: true }).first()).toBeVisible();
  await page.evaluate((route) => {
    window.location.hash = route;
  }, documentRoute);

  await page.locator('.assessment-inline-link').filter({ hasText: 'Командные роли' }).click();
  await expect(page).toHaveURL(new RegExp(`${documentRoute}$`, 'u'));
  const toolWindow = page.locator('.floating-window');
  await expect(toolWindow).toBeVisible();
  await expect(toolWindow.locator('.floating-window__frame')).toHaveAttribute(
    'src',
    /minimed-floating=1.*#\/assessments\//u,
  );

  await toolWindow.getByRole('button', { name: 'Открыть на весь экран' }).click();
  await expect(toolWindow).toHaveClass(/floating-window--fullscreen/u);
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents';
  });
  await expect(toolWindow).toHaveCount(0);

  const calculatorDocumentRoute = '#/modules/documents/d/a3IucmYuNzU1XzEucm90YXZpcnVz';
  await page.evaluate((route) => {
    window.location.hash = route;
  }, calculatorDocumentRoute);
  await page.locator('.calculator-inline-link').first().click();
  await expect(page).toHaveURL(new RegExp(`${calculatorDocumentRoute}$`, 'u'));
  await expect(page.locator('.floating-window__frame')).toHaveAttribute(
    'src',
    /minimed-floating=1.*#\/calculators\//u,
  );
});

test('finds a recommendation section and opens local context', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();
  await expect(page.locator('.result-group-header__kind-label').first()).toHaveText(
    'Клиническая рекомендация',
  );
  await expect(page.getByTestId('search-mode')).toHaveText('FTS5 + VECTOR');
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await page.getByTestId('search-results').getByTestId('search-result').first().click();
  await expect(page.getByTestId('reader-context')).toContainText('Пневмония');
  await expect(page.getByTestId('reader-context')).toContainText(
    'Полные данные находятся в скачиваемом модуле',
  );
});

test('finds medication names in free search with the full companion', async ({ page }) => {
  test.slow();
  test.skip(
    !hasLocalCompanionPack('medications.db'),
    'The full medication companion pack is local-only.',
  );
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });

  await page.getByTestId('search-input').fill('цефтриаксон');
  await expect(page.locator('.result-group').first()).toContainText(/Цефтриаксон/u, {
    timeout: 10_000,
  });
  await expect(
    page.locator('.result-group').first().locator('.result-group-header__kind-label'),
  ).toHaveText('Препарат');
  await expect
    .poll(() => page.locator('.result-group').first().locator('.result-open').count())
    .toBeLessThanOrEqual(3);
  await expect(page.getByTestId('search-results')).not.toContainText('Пневмония (внебольничная)');
});

test('opens Miramistin indications from the full instruction with structured lists', async ({
  page,
}) => {
  test.slow();
  test.skip(
    !hasLocalCompanionPack('medications.db'),
    'The full medication companion pack is local-only.',
  );
  await mountBuiltApp(page, { includeMedicationCompanionPack: true });
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
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible();
  await page.getByTestId('search-results').getByTestId('search-result').first().click();
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
  await outline.getByRole('button', { name: 'Закрыть оглавление' }).click();

  await overlay.getByRole('button', { name: 'Поиск в документе' }).click();
  await overlay
    .getByRole('searchbox', { name: 'Поиск в документе' })
    .fill('официальный идентификатор');
  await expect(overlay.locator('mark').first()).toBeVisible({ timeout: 15_000 });
  await expect(overlay.locator('mark').first()).toHaveText(/официальный/iu);
  await expect(overlay.getByText(/\d+\s*\/\s*\d+/)).toBeVisible();
});

test('renders the complete virtualized document list', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();

  const groups = page.locator('.result-group');
  await expect.poll(() => groups.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /Показать ещё/u })).toHaveCount(0);
});

test('preserves the active search while navigating between mounted routes', async ({ page }) => {
  await mountBuiltApp(page);
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
    window.location.hash = '#/assessments/psychology/braverman-behavioral-profile';
  });
  await expect(page).toHaveURL(/#\/assessments\/psychology\/braverman-behavioral-profile$/u);
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
  const to = await navigationButton(page, 'Заметки').boundingBox();
  const navBounds = await nav.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  if (!from || !to || !navBounds) throw new Error('Bottom navigation is not visible.');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, Math.min(viewportHeight - 4, navBounds.y - 24), {
    steps: 8,
  });
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
  const conditionsCard = page.locator(
    'article[aria-label="Открыть перечень заболеваний и состояний"]',
  );
  const referenceCard = page.locator('article[aria-label="Открыть набор «Нормы и расчёты»"]');
  const toolsCard = page.locator('article[aria-label="Открыть набор «Калькуляторы и опросники»"]');
  await expect(conditionsCard).toBeVisible();
  await expect(toolsCard).toBeVisible();
  await expect(
    conditionsCard.getByRole('button', {
      name: 'Раздел «Заболевания и состояния» недоступен для скачивания: Раздел пока не опубликован',
    }),
  ).toBeDisabled();
  await expect(toolsCard.locator('.recommendation-section-card__actions')).toBeVisible();
  const cardMetaBottomGaps = await Promise.all(
    [conditionsCard, referenceCard, toolsCard].map((card) =>
      card.evaluate((element) => {
        const meta = element.querySelector<HTMLElement>('.recommendation-section-card-meta');
        if (!meta) throw new Error('Section card metadata is missing.');
        return element.getBoundingClientRect().bottom - meta.getBoundingClientRect().bottom;
      }),
    ),
  );
  expect(Math.max(...cardMetaBottomGaps) - Math.min(...cardMetaBottomGaps)).toBeLessThanOrEqual(1);
  await expect(
    page.locator('article[aria-label="Открыть набор «Законы и нормативные акты»"]'),
  ).toBeVisible();
  await expect(page.locator('article[aria-label="Открыть набор «Ядро»"]')).toBeVisible();
  await expect(
    page.locator('article[aria-label="Открыть набор «Клинические рекомендации»"]'),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Открыть набор «Нормы и расчёты»"]')
      .getByRole('button', { name: 'Скачать раздел «Нормы и расчёты»' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Открыть набор «Законы и нормативные акты»"]')
      .getByRole('button', { name: 'Скачать раздел «Законы и нормативные акты»' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Открыть набор «Клинические рекомендации»"]')
      .getByRole('button', { name: 'Скачать раздел «Клинические рекомендации»' }),
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
  await expect(page.getByRole('region', { name: 'Архив документов' })).toBeVisible();
});

test('replays a saved query from the history drawer', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 30_000 });

  // History now lives behind a floating button so the search view stays compact.
  await page.getByRole('button', { name: 'Показать историю поиска' }).click();
  const historyEntry = page
    .locator('.search-history-panel-replay')
    .filter({ hasText: query })
    .first();
  await expect(historyEntry).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('search-input').fill('другой запрос');
  await historyEntry.click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(page.locator('.search-mode-picker--single')).toHaveText('Свободный поиск');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 30_000 });
});

test('runs a debounced clinical search without requiring submit', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 15_000 });
});

test('autosearch leaves the typed text untouched, including trailing space', async ({ page }) => {
  await mountBuiltApp(page);
  // The debounced search used to write the trimmed query back into the field, deleting the space a
  // doctor had just typed mid-sentence.
  await page.getByTestId('search-input').fill(`${query} `);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('search-input')).toHaveValue(`${query} `);
});

test('filters the document library and opens a document with one click', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'База знаний').click();
  await page.locator('article[aria-label="Открыть набор «Ядро»"]').click();
  await page.getByRole('searchbox', { name: 'Поиск по текущему разделу' }).fill('пневмония');
  await page
    .getByRole('button', { name: /Пневмония/u })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Пневмония/u, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поиск в документе' })).toBeVisible();
});

test('opens only the exact fragment without surrounding source context', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('search-results').getByTestId('search-result').first().click();
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Показать текст вокруг' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Открыть полный документ' })).toBeVisible();
  await expect(page.locator('.reader-toolbar')).toHaveCount(0);
});

test('shows neuroinfection clarifications without hiding search results', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill('Менингит или энцефалит у ребёнка');
  await expect(page.getByRole('button', { name: /Сознание и судороги/u })).toBeVisible();
  await expect(page.getByTestId('search-results')).toBeVisible();
});

test('opens settings from the home update notice without applying it', async ({ page }) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    const worker = {
      scriptURL: `${window.location.origin}/sw.js?v=0.6.29`,
      postMessage: (message: unknown) => {
        (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage = message;
      },
    };
    window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
  });

  const update = page.locator('.search-update-status');
  await expect(update).toBeVisible();
  await expect(update).toHaveText(/Доступно обновление/u);
  await update.click();
  await expect(page.getByRole('heading', { name: 'Обновление приложения' })).toBeVisible();
  await expect(page.locator('.search-update-status')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage,
      ),
    )
    .toBeUndefined();
});

test('shows a settings update checker and nav dot when a web update is waiting', async ({
  page,
}) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    const worker = {
      scriptURL: `${window.location.origin}/sw.js?v=0.6.29`,
      postMessage: (message: unknown) => {
        (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage = message;
      },
    };
    window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
  });

  await expect(page.locator('.app-nav-badge--app-update')).toBeVisible();
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /Настройки/u })
    .click();
  await expect(page.getByRole('heading', { name: 'Обновление приложения' })).toBeVisible();
  await expect(page.locator('.settings-update__apply')).toBeVisible();
  await page.locator('.settings-update__apply').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { appUpdateMessage?: unknown }).appUpdateMessage,
      ),
    )
    .toEqual({ type: 'SKIP_WAITING' });
});
