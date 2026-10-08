import { mkdirSync } from 'node:fs';
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

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('phone: the page opens on the calendar table; the header, the numbers and the sources are compact', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);

  // The table is the page: infections down, ages across, one vaccination chip per cell.
  const table = page.getByRole('table', {
    name: 'Национальный календарь профилактических прививок',
  });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(12);
  await expect(table.locator('thead th[scope="col"][data-row-id]')).toHaveCount(15);
  // The vaccinations of the age rows, each in one cell per infection it covers.
  await expect(table.locator('.vax-chart__dose[data-item-id]')).toHaveCount(44);
  await expect(
    table.locator('.vax-chart__row[data-infection="hepatitis-b"] .vax-chart__dose'),
  ).toHaveText(['V1', 'V2', 'V3*', 'V3', 'V4*']);
  await noHorizontalOverflow(page);
  await capture(page, 'phone-390-calendar');

  // Back, title and the header tools share one row; the order numbers are the only legal detail.
  const back = await page.getByRole('button', { name: 'Назад' }).first().boundingBox();
  const title = await page
    .getByRole('heading', { name: 'Календарь прививок', level: 1 })
    .boundingBox();
  const help = await page.getByRole('button', { name: 'Как это работает' }).boundingBox();
  const print = await page.getByRole('button', { name: 'Печать', exact: true }).boundingBox();
  for (const box of [title, help, print]) {
    expect(Math.abs((back?.y ?? 0) - (box?.y ?? 999))).toBeLessThan(30);
  }
  await expect(page.getByText('Приказы № 1122н, № 677н', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('клиническ');
  await expect(page.locator('body')).not.toContainText('Показано');

  // Edition, validity and the official publications: small plain text at the very bottom.
  const sources = page.locator('.vax__sources');
  await expect(sources).toContainText('Приказы Минздрава № 1122н и № 677н');
  await expect(sources).toContainText('Редакция с 01.09.2024 до 01.09.2030');
  await expect(sources.getByRole('link', { name: /№ 1122н, PDF/u })).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/document/0001202112200070',
  );
  await expect(sources.getByRole('link', { name: /№ 677н, PDF/u })).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/document/0001202401300021',
  );
});

test('without a child a tap shows the order text and the page of the official PDF', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);

  await page
    .getByRole('button', { name: /Дифтерия, 3 месяца: Первая вакцинация против дифтерии/u })
    .click();
  const sheet = page.getByRole('dialog', { name: '3 месяца' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.vax-dose')).toHaveCount(3);
  await expect(sheet.locator('.vax-dose[data-item-id="n-05-1"]')).toContainText(
    'Первая вакцинация против дифтерии, коклюша, столбняка',
  );
  await expect(sheet.locator('.vax-dose[data-item-id="n-05-2"]')).toContainText('ИПВ — вакцина');
  await expect(sheet).toContainText('Выберите ребёнка, чтобы отмечать прививки');
  const link = sheet.locator('.vax-dose[data-item-id="n-05-1"]').getByRole('link', {
    name: /Проверить по источнику/u,
  });
  await expect(link).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202112200070#page=3',
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await capture(page, 'phone-390-age-sheet');
  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();

  // The age header opens the same sheet; the group rows (16–19) open their own.
  await page.getByRole('button', { name: '18 месяцев', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '18 месяцев' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.vax-groups__button[data-row-id="n-18"]').click();
  const group = page.getByRole('dialog', { name: /Вакцинация против кори, ревакцинация/u });
  await expect(group).toContainText('взрослые от 36 до 55 лет (включительно)');
  await expect(group.getByRole('link', { name: /Проверить по источнику/u })).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202112200070#page=4',
  );
});

test('behind the «?»: how it works and the order of procedure', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);

  await page.getByRole('button', { name: 'Как это работает' }).click();
  const help = page.getByRole('dialog', { name: 'Как это работает' });
  await expect(help).toContainText('сроков и интервалов приказ не называет');
  await help.getByRole('button', { name: /Порядок проведения прививок/u }).click();
  await expect(help.locator('.vax-procedure__item')).toHaveCount(15);
  await expect(help.locator('[data-item-id="p-15"]')).toContainText('В редакции приказа № 677н');
  await expect(help.locator('[data-item-id="p-05"]')).toContainText('№ 252н');
  await capture(page, 'phone-390-help');
});

test('desktop: the whole table fits; epidemic indications are one switch away and searchable', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCalendar(page);
  await noHorizontalOverflow(page);
  // Every age column is on the screen: no sideways scrolling of the table.
  const scroll = await page.locator('.vax-chart__scroller').evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client + 1);
  await capture(page, 'desktop-1280-calendar');

  await page.getByRole('radio', { name: 'Эпид. показания', exact: true }).check({ force: true });
  const epidemic = page.getByRole('table', {
    name: 'Календарь профилактических прививок по эпидемическим показаниям',
  });
  await expect(epidemic.locator('tbody tr')).toHaveCount(24);
  const covid = epidemic.locator('[data-row-id="e-24"]');
  await expect(covid).toContainText(
    'Против коронавирусной инфекции, вызываемой вирусом SARS-CoV-2',
  );
  await expect(covid).toContainText('Строка в редакции приказа № 677н');
  await expect(
    covid.getByRole('link', { name: /Проверить по источнику: строка 24/u }).first(),
  ).toHaveAttribute(
    'href',
    'http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202401300021#page=2',
  );
  await covid.getByRole('button', { name: 'Прежняя редакция строки' }).click();
  await expect(covid).toContainText('К приоритету 3-го уровня относятся:');
  await page.getByRole('searchbox', { name: 'Инфекция или категория' }).fill('клещевой энцефалит');
  await expect(epidemic.locator('tbody tr')).toHaveCount(1);
  await expect(epidemic.locator('[data-row-id="e-07"]')).toContainText(
    'Против клещевого вирусного энцефалита',
  );
  await expect(page.getByRole('status')).toHaveText('1 из 24');
  await capture(page, 'desktop-1280-epidemic');
  await page.getByRole('searchbox', { name: 'Инфекция или категория' }).fill('нет такого');
  await expect(page.getByText('Ничего не найдено.')).toBeVisible();
});

test('phone: epidemic indications are cards that open in place', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page, '#/notes/vaccination?part=epidemic');

  await expect(page.getByRole('radio', { name: 'Эпид. показания', exact: true })).toBeChecked();
  await expect(page.getByRole('table')).toHaveCount(0);
  const cards = page.locator('.vax-cards__item');
  await expect(cards).toHaveCount(24);
  await cards.filter({ hasText: 'Против брюшного тифа' }).getByRole('button').click();
  await expect(page.locator('.vax-cards__item[data-row-id="e-11"]')).toContainText(
    'Контактные лица в очагах брюшного тифа по эпидемическим показаниям.',
  );
  await noHorizontalOverflow(page);
  await capture(page, 'phone-390-epidemic');
});
