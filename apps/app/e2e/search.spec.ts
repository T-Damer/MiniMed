import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from '@localmed/app/e2e/clinical-module-fixture';
import {
  E2E_ASSET_ORIGIN,
  hasLocalCompanionPack,
  mountBuiltApp,
} from '@localmed/app/e2e/mount-built-app';
import {
  selectSearchSection,
  setClinicalAnalysis,
  waitForHomeSections,
} from '@localmed/app/e2e/select-search-section';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { openSettingsPage } from './settings-nav';

// These assertions qualify full-corpus results on CI; latency is measured by benchmarks.
const query = 'пневмония';

// Routes stay mounted to preserve search state, so assertions must target the active results container
// rather than matching an identically titled document in the hidden Documents view.
function pneumoniaResult(page: Page): Locator {
  return page
    .getByTestId('search-results')
    .getByText(/Пневмония/u)
    .first();
}

/**
 * The first hit inside a clinical-recommendation group. Ordinary lookup keeps an exact title first
 * (for «пневмония» the reference index card of that name); the recommendation follows it.
 */
function clinicalRecommendationResult(page: Page): Locator {
  return page
    .getByTestId('search-results')
    .locator('.result-group')
    .filter({
      has: page.locator('.result-group-header__kind-label', {
        hasText: 'Клиническая рекомендация',
      }),
    })
    .first()
    .getByTestId('search-result')
    .first();
}

/** Knowledge-base routes stay empty until the medical core has opened. */
async function waitForSearchReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );
}

function navigationButton(page: Page, name: string): Locator {
  return page.locator('.app-bottom-nav').getByRole('button', { name });
}

test('opens with source lookup ready and clinical parsing as a separate mode', async ({ page }) => {
  await mountBuiltApp(page);

  await expect(page.getByTestId('search-input')).toBeVisible();
  // The field is on screen at once and editable as soon as the core has opened.
  await expect(page.getByTestId('search-input')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('search-submit')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Раздел поиска', exact: true })).toContainText(
    'Все источники',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByTestId('search-input').fill('ребёнок 5 лет кашель');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible();
  await expect(page.locator('.analysis-details')).toHaveCount(0);
  await setClinicalAnalysis(page, true);
  await expect(page.locator('.analysis-details')).toBeVisible();
  // The switch reads the same source; turning it off returns to plain lookup.
  await expect(page.getByRole('button', { name: 'Раздел поиска', exact: true })).toContainText(
    'Все источники',
  );
  await setClinicalAnalysis(page, false);
  await expect(page.locator('.analysis-details')).toHaveCount(0);
});

test('the help menu opens the feature tour and the search guide', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.getByRole('button', { name: 'Показать историю поиска' })).toBeVisible();
  await page.getByRole('button', { name: 'Справка', exact: true }).click();
  await page.getByRole('button', { name: 'Что умеет MiniMed' }).click();
  await expect(page.getByRole('dialog', { name: 'Что умеет MiniMed' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Что умеет MiniMed' })).toHaveCount(0);
  // Playwright's click scrolled the page to reach the menu item; closing the dialog restores that
  // scroll, and a menu opened meanwhile is dismissed. Wait for the page to settle first.
  await expect
    .poll(async () => {
      const first = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(150);
      return first === (await page.evaluate(() => window.scrollY));
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Справка', exact: true }).click();
  await page.getByRole('button', { name: 'Как работает поиск' }).click();
  await expect(page.getByRole('dialog', { name: 'Как работает поиск' })).toBeVisible();
});

test('the tool row holds «Все инструменты» and only the tools the doctor starred', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const row = page.locator('.search-quick-access');
  await expect(row.locator('.search-quick-access__chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  for (const group of ['Приём', 'Расчёты', 'Справочное', 'Файлы']) {
    await expect(sheet.getByRole('heading', { name: group, exact: true })).toBeVisible();
  }
  await sheet.getByRole('button', { name: 'Добавить «Формы» в избранное' }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await row.getByRole('button', { name: 'Формы', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/forms$/u);
});

/** The active position dot names the slide in view: «Функция 2 из 4» → 2. */
async function activeFeature(page: Page): Promise<number> {
  const label = await page
    .getByRole('region', { name: 'Полезные функции' })
    .locator('.carousel__dot--active')
    .getAttribute('aria-label');
  return Number(/(\d+) из/u.exec(label ?? '')?.[1]);
}

for (const width of [375, 1280]) {
  test(`the field leads the home; tools and «Полезные функции» follow it at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const carousel = page.getByRole('region', { name: 'Полезные функции' });
    await expect(carousel).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Добр(ое|ый|ой)/u })).toHaveCount(0);
    // Field first, then the tool row, then the capability cards.
    const field = await page.locator('.query-sheet').boundingBox();
    const tools = await page
      .getByRole('button', { name: 'Все инструменты', exact: true })
      .boundingBox();
    const cards = await carousel.boundingBox();
    expect(field && tools && cards && field.y + field.height <= tools.y && tools.y < cards.y).toBe(
      true,
    );
    // No header row: the carousel is named for assistive tech only, positions are dots.
    await expect(carousel.getByText('Полезные функции')).toHaveCount(0);

    // Every slide has the height of the tallest one; one dot per slide, the current one marked.
    const slides = carousel.locator('.carousel__slide');
    const total = await slides.count();
    expect(total).toBeGreaterThanOrEqual(3);
    const heights = await slides.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().height)),
    );
    expect(new Set(heights).size).toBe(1);
    // A gap between slides, and arrows that are fully on the screen, under the slides.
    expect(
      await carousel
        .locator('.carousel__track')
        .evaluate((track) => Number.parseFloat(getComputedStyle(track).columnGap)),
    ).toBeGreaterThan(0);
    for (const name of ['Предыдущая', 'Следующая']) {
      const arrow = await carousel.getByRole('button', { name }).boundingBox();
      expect(arrow && arrow.x >= 0 && arrow.x + arrow.width <= width).toBe(true);
    }
    const dots = carousel.locator('.carousel__dot');
    await expect(dots).toHaveCount(total);
    await expect(carousel.locator('.carousel__dot--active')).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Arrows walk through every capability and wrap; the visible slide follows the dots.
    const settledSlide = () =>
      carousel.evaluate((element) => {
        const track = element.querySelector('.carousel__track') as HTMLElement;
        const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
        const index = Math.round(track.scrollLeft / (track.clientWidth + gap));
        const title = element.querySelectorAll('.carousel__slide')[index]?.querySelector('h2');
        return { index, title: title?.textContent?.trim() ?? '' };
      });
    const titles = new Set<string>();
    for (let step = 0; step < total; step += 1) {
      const shown = await activeFeature(page);
      await expect.poll(async () => (await settledSlide()).index).toBe(shown - 1);
      titles.add((await settledSlide()).title);
      await carousel.getByRole('button', { name: 'Следующая' }).click();
      await expect.poll(() => activeFeature(page)).toBe((shown % total) + 1);
    }
    expect(titles.size).toBe(total);
    expect([...titles]).toEqual(expect.arrayContaining(['ЭКГ по фото', 'Просмотр исследований']));

    // A dot jumps straight to its capability.
    await carousel.getByRole('button', { name: `Функция 1 из ${total}` }).click();
    await expect.poll(() => activeFeature(page)).toBe(1);
    await expect
      .poll(() => carousel.locator('.carousel__track').evaluate((track) => track.scrollLeft))
      .toBe(0);

    // «Как это работает» is a round «?»; a second action is a button beside the first.
    await expect(carousel.getByRole('link', { name: 'Как это работает' })).toHaveCount(1);
    await expect(carousel.getByText('Как это работает', { exact: true })).toHaveCount(0);
    await expect(
      carousel.locator('.home-feature__action--secondary', { hasText: 'Мои файлы' }),
    ).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });

    // Everything under the field folds away completely while typing.
    await page.getByTestId('search-input').fill('пнев');
    await expect(page.locator('.search-heading')).toHaveClass(/search-heading--hidden/u);
    await expect
      .poll(() =>
        page
          .locator('.search-heading')
          .evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBe(0);
  });

  test(`the field holds only input, source, clinical switch and send at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchReady(page);
    const sheet = page.locator('.query-sheet');
    const input = page.getByTestId('search-input');
    // Rare actions live in the top row, not in the field.
    await expect(sheet.getByRole('button', { name: 'Случайная запись' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Карта связей' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Случайная запись' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Раздел поиска', exact: true })).toBeVisible();
    const clinical = sheet.getByRole('button', { name: 'Клинический разбор', exact: true });
    await expect(clinical).toHaveAttribute('aria-pressed', 'false');

    // A clean one-line field: no notebook margin line, no empty second line before typing.
    const sheetDecor = await sheet.evaluate(
      (element) => getComputedStyle(element, '::before').content,
    );
    expect(sheetDecor).toBe('none');
    const inputHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
    expect(inputHeight).toBeLessThan(60);

    // Clearing is a × inside the field that appears with text.
    const clear = sheet.getByRole('button', { name: 'Очистить запрос' });
    await expect(clear).toHaveCount(0);
    await input.fill('пневмония');
    await expect(clear).toBeVisible();
    // Everything under the field has folded away completely before the screenshot.
    await expect
      .poll(() =>
        page
          .locator('.search-heading')
          .evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBe(0);
    const [clearBox, inputBox] = await Promise.all([clear.boundingBox(), input.boundingBox()]);
    expect(
      clearBox && inputBox && clearBox.x + clearBox.width <= inputBox.x + inputBox.width + 1,
    ).toBe(true);
    // Nothing under the folded field: not even the old archive-folder edge.
    const folderEdge = await page
      .locator('.search-column')
      .evaluate((element) => getComputedStyle(element).borderBottomWidth);
    expect(folderEdge).toBe('0px');
    await page.screenshot({ path: testInfo.outputPath(`field-${width}.png`) });
    await clear.click();
    await expect(input).toHaveValue('');
    await expect(clear).toHaveCount(0);

    // Sending is one round button, on the same row as the source picker and the brain toggle.
    await input.fill('пневмония');
    const send = sheet.getByRole('button', { name: 'Найти', exact: true });
    await expect(send).toBeVisible();
    const rowCentres = await Promise.all(
      [sheet.getByRole('button', { name: 'Раздел поиска', exact: true }), clinical, send].map(
        async (control) => {
          const box = await control.boundingBox();
          return box ? box.y + box.height / 2 : Number.NaN;
        },
      ),
    );
    expect(Math.max(...rowCentres) - Math.min(...rowCentres)).toBeLessThan(6);
    // The toggle states its state, and flips it back.
    await clinical.click();
    await expect(clinical).toHaveAttribute('aria-pressed', 'true');
    await clinical.click();
    await expect(clinical).toHaveAttribute('aria-pressed', 'false');
    await send.click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 30_000 });
  });

  test(`«Полезные функции» autoplay stops once the user takes over at ${width}px`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const carousel = page.getByRole('region', { name: 'Полезные функции' });
    await expect(carousel.locator('.carousel__dot--active')).toBeVisible();
    await page.mouse.move(0, 0);
    const start = await activeFeature(page);
    await page.clock.runFor(7_500);
    await expect.poll(() => activeFeature(page)).not.toBe(start);

    // Hover holds it; an arrow press stops it for good.
    await carousel.hover();
    const held = await activeFeature(page);
    await page.clock.runFor(15_000);
    expect(await activeFeature(page)).toBe(held);
    await carousel.getByRole('button', { name: 'Предыдущая' }).click();
    const chosen = await activeFeature(page);
    await page.mouse.move(0, 0);
    await page.clock.runFor(15_000);
    expect(await activeFeature(page)).toBe(chosen);
  });

  test(`«Полезные функции» never autoplays with reduced motion at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await expect(
      page.getByRole('region', { name: 'Полезные функции' }).locator('.carousel__dot--active'),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    const start = await activeFeature(page);
    await page.clock.runFor(30_000);
    expect(await activeFeature(page)).toBe(start);
  });
}

const SECTION_NOUNS: Readonly<Record<string, readonly [string, string, string]>> = {
  'МКБ, симптомы и состояния': ['запись', 'записи', 'записей'],
  'Клинические рекомендации': ['рекомендация', 'рекомендации', 'рекомендаций'],
  Препараты: ['действующее вещество', 'действующих вещества', 'действующих веществ'],
  'Нормативные документы': ['документ', 'документа', 'документов'],
  Опросники: ['опросник', 'опросника', 'опросников'],
  Калькуляторы: ['калькулятор', 'калькулятора', 'калькуляторов'],
};

function russianForm(count: number, [one, few, many]: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

for (const width of [375, 1280]) {
  test(`the empty home lists sections with correctly worded counts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForHomeSections(page);
    const rows = page.locator('.search-sections__row');
    await expect(rows).toHaveCount(Object.keys(SECTION_NOUNS).length);
    // No endless all-sources catalog under the empty field.
    await expect(page.locator('.unified-catalog')).toHaveCount(0);
    for (const [label, forms] of Object.entries(SECTION_NOUNS)) {
      const text = (
        await rows.filter({ hasText: label }).locator('.search-sections__count').innerText()
      ).trim();
      if (text === 'нет в установленных базах') continue;
      const count = Number(text.replace(/\D+[^\d]*$/u, '').replace(/\D/gu, ''));
      expect(text, label).toBe(
        `${count.toLocaleString('ru-RU')}\u00a0${russianForm(count, forms)}`,
      );
    }
    await rows.filter({ hasText: 'Калькуляторы' }).click();
    await expect(page.getByRole('button', { name: 'Раздел поиска', exact: true })).toContainText(
      'Калькуляторы',
    );
    await expect(page.locator('.unified-catalog__tool').first()).toBeVisible();
    await expect(rows).toHaveCount(0);
    await selectSearchSection(page, 'Все источники');
    await expect(rows.first()).toBeVisible();
    await page.getByTestId('search-input').fill('пнев');
    await expect(rows).toHaveCount(0);
  });
}

test('renders ordinary lookup on a phone-sized browser and records query latency', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
  await expect(page.getByTestId('search-input')).toBeEnabled();
  const timings: number[] = [];
  for (const value of ['пневмония', 'отит', 'анемия']) {
    const started = Date.now();
    await page.getByTestId('search-input').fill(value);
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('search-submit')).toBeEnabled({ timeout: 30000 });
    timings.push(Date.now() - started);
  }
  console.log('ordinary lookup milliseconds:', timings);
  await page.screenshot({ path: test.info().outputPath('ordinary-search-phone.png') });
  const picker = await page
    .getByRole('button', { name: 'Раздел поиска', exact: true })
    .boundingBox();
  const submit = await page.getByTestId('search-submit').boundingBox();
  expect(picker).not.toBeNull();
  expect(submit).not.toBeNull();
  if (picker && submit) {
    expect(picker.x).toBeGreaterThanOrEqual(0);
    expect(submit.x + submit.width).toBeLessThanOrEqual(375);
  }
});

test('runs a selected calculator inline without leaving search', async ({ page }) => {
  await mountBuiltApp(page);

  await expect(page.getByRole('button', { name: 'Выбрать калькулятор' })).toHaveCount(0);
  await page.getByTestId('search-input').fill('@');
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

  // Typing collapses the home welcome block with a short transition; the picker follows its
  // anchor, so judge the settled layout rather than a mid-transition frame.
  await expect
    .poll(async () => {
      const inputBox = await input.boundingBox();
      const menuBox = await menu.boundingBox();
      if (!inputBox || !menuBox) throw new Error('Search picker geometry is unavailable.');
      return menuBox.y >= inputBox.y + inputBox.height || menuBox.y + menuBox.height <= inputBox.y;
    })
    .toBe(true);
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
  test.setTimeout(240_000);
  await routeClinicalModule(page);
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

  // An installed recommendation whose text names calculators (CHA2DS2-VASc, ankle-brachial index).
  await installClinicalModule(page);
  const calculatorDocumentRoute = new URL(CLINICAL_DOCUMENT_ROUTE).hash;
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
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
  // Lookup is lexical only (no vector mode label); a recommendation is among the first groups.
  await expect(clinicalRecommendationResult(page)).toBeVisible();
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
  await clinicalRecommendationResult(page).click();
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
  await expect(page.locator('.result-group').first()).toContainText(/цефтриаксон/iu, {
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
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
  await clinicalRecommendationResult(page).click();
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

test('renders the complete virtualized document list', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();

  const groups = page.locator('.result-group');
  await expect.poll(() => groups.count(), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /Показать ещё/u })).toHaveCount(0);
  const expandable = groups.filter({ has: page.locator('.result-group__more') }).first();
  await expect(expandable).toBeVisible();
  const excerpts = expandable.getByTestId('search-result').filter({ visible: true });
  await expect(excerpts).toHaveCount(1);
  const toggle = expandable.getByRole('button', { name: /^Ещё \d+ фрагмент/u });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => excerpts.count()).toBeGreaterThan(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(expandable.locator('.ui-disclosure__panel')).toHaveAttribute('inert', '');
  const kind = expandable.locator('.result-group-header__kind');
  await expect(kind).toHaveCSS('opacity', '1');
  await expect(kind).toHaveCSS('position', 'static');
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await expect(groups.first()).toBeVisible();
      await page.mouse.move(0, 0);
      await expect
        .poll(async () =>
          page
            .locator(
              '.result-group-header__title, .result-group-header__kind, .result-group-header__content-kind, .result-group-header__note, .result-snippet, .result-path, .category-stamp, .result-group__more .ui-disclosure__title, .choice-chip__label, .choice-chip__detail, .highlighted-text__match',
            )
            .evaluateAll((nodes) => {
              const canvas = new OffscreenCanvas(1, 1);
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas is required to resolve CSS colors.');
              const rgba = (color: string): number[] => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                return [...context.getImageData(0, 0, 1, 1).data];
              };
              const blend = (front: number[], back: number[]): number[] =>
                front.slice(0, 3).map((value, index) => {
                  const alpha = (front[3] ?? 255) / 255;
                  return value * alpha + (back[index] ?? 0) * (1 - alpha);
                });
              const luminance = (color: number[]): number =>
                color.slice(0, 3).reduce((sum, value, index) => {
                  const channel = value / 255;
                  return (
                    sum +
                    (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) *
                      ([0.2126, 0.7152, 0.0722][index] ?? 0)
                  );
                }, 0);
              return nodes.flatMap((node) => {
                if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
                  return [];
                const ancestors: Element[] = [];
                for (let parent: Element | null = node; parent; parent = parent.parentElement)
                  ancestors.unshift(parent);
                const background = ancestors.reduce(
                  (color, parent) => blend(rgba(getComputedStyle(parent).backgroundColor), color),
                  [255, 255, 255],
                );
                const foreground = blend(rgba(getComputedStyle(node).color), background);
                const levels = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
                const ratio = ((levels[1] ?? 0) + 0.05) / ((levels[0] ?? 0) + 0.05);
                return ratio < 4.5 ? [{ class: node.className, ratio }] : [];
              });
            }),
        )
        .toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`results-${width}-${colorScheme}.png`),
        animations: 'disabled',
      });
    }
  }
});

test('preserves the active search while navigating between mounted routes', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });

  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible();
  await navigationButton(page, 'Поиск').click();

  await expect(page.getByTestId('search-input')).toHaveValue(query);
  await expect(pneumoniaResult(page)).toBeVisible();
});

test('returns to the documents route after opening a questionnaire', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);

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
  // The MKB and disease-article modules live in this section and are published (9d576bd0).
  await expect(
    conditionsCard.getByRole('button', { name: 'Скачать раздел «Заболевания и состояния»' }),
  ).toBeEnabled();
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
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });

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
  await expect(page.getByRole('button', { name: 'Раздел поиска', exact: true })).toContainText(
    'Все источники',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
});

test('runs a debounced clinical search without requiring submit', async ({ page }) => {
  await mountBuiltApp(page);
  await page.getByTestId('search-input').fill(query);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
});

test('autosearch leaves the typed text untouched, including trailing space', async ({ page }) => {
  await mountBuiltApp(page);
  // The debounced search used to write the trimmed query back into the field, deleting the space a
  // doctor had just typed mid-sentence.
  await page.getByTestId('search-input').fill(`${query} `);
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
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
  await expect(pneumoniaResult(page)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('search-results').getByTestId('search-result').first().click();
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Показать текст вокруг' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Открыть полный документ' })).toBeVisible();
  await expect(page.locator('.reader-toolbar')).toHaveCount(0);
});

test('opens a random record of the current section', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  await selectSearchSection(page, 'Клинические рекомендации');
  const dice = page.getByRole('button', { name: 'Случайная запись' });
  await expect(dice).toBeEnabled({ timeout: 30_000 });
  await dice.click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  await expect(page.locator('.document-page')).toBeVisible();
  // The route carries the document id (base64url); it must come from the selected section.
  const documentId = await page.evaluate(() => {
    const encoded = location.hash.split('/d/')[1]?.split(/[/?#]/u)[0] ?? '';
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
  });
  expect(documentId).toMatch(/kr\.rf\.|clinical/u);
});

test('shows neuroinfection clarifications without hiding search results', async ({ page }) => {
  await mountBuiltApp(page);
  // Clarifying questions belong to the explicit clinical mode, not to ordinary lookup.
  await setClinicalAnalysis(page, true);
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
  await openSettingsPage(page, 'Основные');
  await expect(page.getByTestId('settings-status-general')).toHaveText('Есть обновление');
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
