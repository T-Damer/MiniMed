import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const SCREENS = resolve(import.meta.dirname, '../../../output/vax1-screens');
const CAPTURE = process.env['VAX1_CAPTURE_SCREENS'] === '1';

async function capture(page: Page, name: string): Promise<void> {
  if (!CAPTURE) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: false });
}

async function openCalendar(page: Page, hash = '#/notes/vaccination'): Promise<void> {
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
}

/** The same HTML the preview shows and the print window receives, taken from the preview frame. */
async function printHtml(page: Page): Promise<string> {
  const html = await page
    .locator('iframe[title="Предпросмотр печати календаря прививок"]')
    .getAttribute('srcdoc');
  expect(html).toContain('class="vax-print"');
  return html ?? '';
}

test('desktop: the whole national calendar is a real table with sticky headers, filters and the epidemic table', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCalendar(page);

  const edition = page.getByRole('region', { name: 'Редакция и источник' });
  await expect(edition).toContainText('Приказ № 1122н в ред. приказа № 677н');
  await expect(edition).toContainText('Приказ Минздрава России от 06.12.2021 № 1122н');
  await expect(edition).toContainText('клиническую проверку врач ещё не проводил');

  // Appendix 1 as the order prints it: three printed columns plus the source column.
  const table = page.getByRole('table', {
    name: 'Национальный календарь профилактических прививок',
  });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(19);
  await expect(table.getByRole('columnheader')).toHaveText([
    '№ п/п',
    'Категории и возраст граждан, подлежащих обязательной вакцинации',
    'Наименование профилактической прививки',
    'Источник',
  ]);
  const rowFive = table.locator('[data-row-id="n-05"]');
  await expect(rowFive).toContainText('Дети 3 месяца');
  await expect(rowFive.getByRole('listitem')).toHaveText([
    'Первая вакцинация против дифтерии, коклюша, столбняка',
    'Первая вакцинация против полиомиелита',
    'Первая вакцинация против гемофильной инфекции типа b',
  ]);
  await expect(page.getByText('Показано 19 из 19 строк')).toBeVisible();
  await capture(page, 'desktop-1280-national');

  // «Проверить по источнику» opens the official PDF at the page of the row.
  const link = rowFive.getByRole('link', { name: /Проверить по источнику/u });
  await expect(link).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202112200070#page=3',
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(rowFive).toContainText('приказ № 1122н, стр. 3');
  await expect(table.locator('[data-row-id="n-18"]')).toContainText('стр. 4–5');

  // The header stays visible while the table scrolls.
  const header = table.getByRole('columnheader').first();
  await table.locator('[data-row-id="n-15"]').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox?.y ?? 9999).toBeLessThan(120);
  await capture(page, 'desktop-1280-national-scrolled');
  await page.mouse.wheel(0, -4000);

  // Filters: children, an age and the adult row.
  await page.getByRole('radio', { name: 'Взрослые', exact: true }).check({ force: true });
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(page.getByText('Показано 5 из 19 строк')).toBeVisible();
  await page.getByRole('radio', { name: 'Дети', exact: true }).check({ force: true });
  await expect(table.locator('tbody tr')).toHaveCount(18);
  await page.getByRole('radio', { name: 'Все', exact: true }).check({ force: true });
  await page.getByRole('combobox', { name: /^Возраст/u }).selectOption('n-06');
  // The age row and the four category rows the order does not tie to an age.
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(table.locator('[data-row-id="n-06"]')).toContainText('Дети 4,5 месяца');
  await expect(table.locator('[data-row-id="n-19"]')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(19);

  // The summary grid regroups the same vaccinations by infection.
  await page.getByRole('radio', { name: 'Сводка по возрасту', exact: true }).check({ force: true });
  const grid = page.getByRole('table', { name: 'Сводка национального календаря по возрасту' });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('columnheader')).toHaveCount(16);
  await expect(grid.locator('[data-infection="hepatitis-b"] .vax-grid__dose')).toHaveText([
    'V1',
    'V2',
    'V3*',
    'V3',
    'V4*',
  ]);
  await expect(page.getByText('Прививки по категориям (строки 16–19)')).toBeVisible();
  await capture(page, 'desktop-1280-grid');
  await page.getByRole('radio', { name: 'Как в приказе', exact: true }).check({ force: true });

  // Appendix 2: every row, the amended one marked, a search over infections and categories.
  await page
    .getByRole('radio', { name: 'Эпидемические показания', exact: true })
    .check({ force: true });
  const epidemic = page.getByRole('table', {
    name: 'Календарь профилактических прививок по эпидемическим показаниям',
  });
  await expect(epidemic.locator('tbody tr')).toHaveCount(24);
  const covid = epidemic.locator('[data-row-id="e-24"]');
  await expect(covid).toContainText(
    'Против коронавирусной инфекции, вызываемой вирусом SARS-CoV-2',
  );
  await expect(covid).toContainText('лица с первичными или вторичными иммунодефицитами');
  await expect(covid).toContainText('Строка в редакции приказа № 677н');
  await expect(
    covid.getByRole('link', { name: /Проверить по источнику: строка 24/u }).first(),
  ).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202401300021#page=2',
  );
  await covid.getByRole('button', { name: 'Показать прежнюю редакцию строки' }).click();
  await expect(covid).toContainText('К приоритету 3-го уровня относятся:');
  await page.getByRole('searchbox', { name: 'Инфекция или категория' }).fill('клещевой энцефалит');
  await expect(epidemic.locator('tbody tr')).toHaveCount(1);
  await expect(epidemic.locator('[data-row-id="e-07"]')).toContainText(
    'Против клещевого вирусного энцефалита',
  );
  await capture(page, 'desktop-1280-epidemic');
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(epidemic.locator('tbody tr')).toHaveCount(24);

  // Appendix 3 with its footnotes.
  await page.getByRole('radio', { name: 'Порядок', exact: true }).check({ force: true });
  const procedure = page.getByRole('region', {
    name: 'Порядок проведения профилактических прививок',
  });
  await expect(procedure.locator('.vax-procedure__item')).toHaveCount(15);
  await expect(procedure.locator('[data-item-id="p-15"]')).toContainText(
    'В редакции приказа № 677н',
  );
  await expect(procedure.locator('[data-item-id="p-05"]')).toContainText('№ 252н');
});

test('phone: every row is a card with its vaccinations in an expandable body and nothing is lost', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);

  const cards = page.locator('.vax-cards__item');
  await expect(cards).toHaveCount(19);
  await expect(page.getByRole('table')).toHaveCount(0);
  await capture(page, 'phone-390-national');

  const rowFive = page.locator('.vax-cards__item[data-row-id="n-05"]');
  await expect(rowFive.getByRole('button', { name: /Дети 3 месяца/u })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await rowFive.getByRole('button', { name: /Дети 3 месяца/u }).click();
  await expect(rowFive.getByRole('listitem')).toHaveText([
    'Первая вакцинация против дифтерии, коклюша, столбняка',
    'Первая вакцинация против полиомиелита',
    'Первая вакцинация против гемофильной инфекции типа b',
  ]);
  await expect(rowFive.getByRole('link', { name: /Проверить по источнику/u })).toBeVisible();
  await capture(page, 'phone-390-national-expanded');

  // «Развернуть все строки» shows every vaccination of the order, category rows included.
  await page.getByRole('button', { name: 'Развернуть все строки' }).click();
  await expect(page.locator('.vax-cards__item .vax-items__item')).toHaveCount(29 + 4);
  const categoryRow = page.locator('.vax-cards__item[data-row-id="n-18"]');
  await expect(categoryRow).toContainText('взрослые от 36 до 55 лет (включительно)');
  await expect(categoryRow).toContainText('Вакцинация против кори, ревакцинация против кори');
  await expect(page.getByRole('button', { name: 'Свернуть все строки' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page
    .getByRole('radio', { name: 'Эпидемические показания', exact: true })
    .check({ force: true });
  await expect(page.locator('.vax-cards__item')).toHaveCount(24);
  await page.getByRole('button', { name: 'Развернуть все строки' }).click();
  await expect(page.locator('.vax-cards__item[data-row-id="e-11"]')).toContainText(
    'Против брюшного тифа',
  );
  await expect(page.locator('.vax-cards__item[data-row-id="e-11"]')).toContainText(
    'Контактные лица в очагах брюшного тифа по эпидемическим показаниям.',
  );
  await capture(page, 'phone-390-epidemic-expanded');
});

test('plan: dates are calculated from the birth date, labelled as calculated, with the order conditions', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page, '#/notes/vaccination?part=plan');

  await expect(page.getByText('Расчётные даты по возрастам национального календаря')).toBeVisible();
  await expect(page.getByText('Дата рождения нигде не сохраняется')).toBeVisible();
  const birth = page.getByLabel('Дата рождения ребёнка');
  const today = new Date();
  const born = new Date(today.getFullYear() - 1, today.getMonth(), 15);
  const iso = (value: Date): string =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  await birth.fill(iso(born));
  await expect(page.locator('.vax-plan__entry')).toHaveCount(14);
  await expect(page.locator('.vax-plan__entry[data-status="current"]')).toHaveCount(1);
  const first = page.locator('.vax-plan__entry[data-row-id="n-01"]');
  await expect(first.locator('.vax-plan__date-value')).toHaveText(
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
      born,
    ),
  );
  await expect(page.locator('.vax-plan__entry[data-row-id="n-04"]')).toContainText(
    'Третья вакцинация против вирусного гепатита В (группы риска)',
  );
  await expect(page.locator('.vax-plan__entry[data-row-id="n-04"]')).toContainText(
    'условия: п. 9 приложения № 3',
  );
  await expect(
    page.locator('.vax-plan__entry[data-row-id="n-06"] .vax-plan__date-value'),
  ).toContainText('≈');
  await capture(page, 'phone-390-plan');

  await page.getByRole('button', { name: /Условия из порядка проведения прививок/u }).click();
  await expect(
    page.getByText(
      'Допускается введение вакцин (за исключением вакцин для профилактики туберкулеза)',
    ),
  ).toBeVisible();

  // The birth date is not kept in the address or in storage.
  expect(page.url()).not.toContain(iso(born));
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(stored).not.toContain(iso(born));

  await birth.fill('');
  await expect(page.locator('.vax-plan__entry')).toHaveCount(0);
  await birth.fill(iso(new Date(today.getFullYear() + 1, 0, 1)));
  await expect(page.getByRole('alert')).toContainText('не может быть позже сегодняшнего дня');
});

test('print: the preview holds the whole order on A4 landscape sheets', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCalendar(page);

  await page.getByRole('button', { name: 'Печать', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Предпросмотр печати, A4 альбомная');
  const frame = page.frameLocator('iframe[title="Предпросмотр печати календаря прививок"]');
  await expect(frame.locator('.vax-print__edition')).toHaveText(
    'по приказу № 1122н в ред. приказа № 677н',
  );
  await expect(frame.locator('#appendix-1 tbody tr')).toHaveCount(19);
  await expect(frame.locator('#appendix-2 tbody tr')).toHaveCount(24);
  await expect(frame.locator('#appendix-3 .vax-print__procedure')).toHaveCount(15);
  await expect(frame.locator('#appendix-3 .vax-print__footnote')).toHaveCount(3);
  await expect(frame.locator('.vax-print__footer')).toContainText(
    'http://publication.pravo.gov.ru/document/0001202112200070',
  );
  await expect(frame.locator('.vax-print__footer')).toContainText(
    'клиническая проверка врачом не проводилась',
  );
  await capture(page, 'desktop-1280-print-preview');

  // Real pagination: Chromium makes a PDF from the print page and honours @page A4 landscape.
  const html = await printHtml(page);
  const sheet = await page.context().newPage();
  try {
    await sheet.setContent(html);
    await sheet.emulateMedia({ media: 'print' });
    // Nothing is cut off horizontally and no table cell overflows its column.
    const widths = await sheet.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      tables: [...document.querySelectorAll('table')].map(
        (table) => table.scrollWidth - table.clientWidth,
      ),
    }));
    expect(Math.max(...widths.tables)).toBeLessThanOrEqual(1);
    const pdf = await sheet.pdf({ preferCSSPageSize: true, printBackground: true });
    const source = pdf.toString('latin1');
    const pages = (source.match(/\/Type\s*\/Page(?![a-z])/gu) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(6);
    expect(pages).toBeLessThanOrEqual(14);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(source);
    expect(Number(box?.[1])).toBeGreaterThan(Number(box?.[2]));
    expect(Number(box?.[1])).toBeCloseTo(841.89, 0);
    if (CAPTURE) {
      mkdirSync(SCREENS, { recursive: true });
      writeFileSync(`${SCREENS}/vaccination-calendar-print.pdf`, pdf);
      await sheet.setViewportSize({ width: 1123, height: 794 });
      await sheet.screenshot({ path: `${SCREENS}/print-media-appendix-1.png`, fullPage: true });
    }
  } finally {
    await sheet.close();
  }
});

test('the tool is listed in «Все инструменты» for children and adults and found by search', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  await sheet.getByText('Календарь прививок', { exact: true }).first().click();
  await expect(page).toHaveURL(/#\/notes\/vaccination$/u);
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
});

test('search finds the calendar by «прививки» and opens it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.getByTestId('search-input').fill('график прививок');
  const card = page.getByRole('link', { name: 'Календарь прививок', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('href', '#/notes/vaccination');
  await capture(page, 'phone-390-search');
  await card.click();
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
});
