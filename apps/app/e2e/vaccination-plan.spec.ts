import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// Set VAC2_CAPTURE_DIR to write screenshots and the PDF of the handout.
const CAPTURE_DIR = process.env['VAC2_CAPTURE_DIR'];
// The statuses depend on today: the tests run on a fixed day. A child born 2026-01-10 is then 8
// months old: ages up to 4,5 months have passed (11 vaccinations, none marked), 6 months is now (4).
const TODAY = new Date('2026-10-08T12:00:00');

async function capture(page: Page, name: string): Promise<void> {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${CAPTURE_DIR}/${name}.png` });
}

async function createPatient(page: Page, name: string, birthDate?: string): Promise<void> {
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }).press('Enter');
  const unlock = page.getByRole('button', { name: /^(Понятно, продолжить|Открыть)$/u });
  const heading = page.getByRole('heading', { name: 'Новая карточка пациента' });
  await unlock.or(heading).first().waitFor();
  if (await unlock.isVisible()) await unlock.click();
  await expect(heading).toBeVisible();
  await page.getByLabel('Имя или псевдоним').fill(name);
  if (birthDate) await page.getByLabel('Дата рождения').fill(birthDate);
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function openCalendar(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/notes/vaccination';
  });
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toBeVisible();
}

async function leaveCalendar(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/notes';
  });
  await expect(page.getByRole('heading', { name: 'Календарь прививок', level: 1 })).toHaveCount(0);
}

async function chooseChild(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^(Выбрать|Сменить) ребёнка$/u }).click();
  await page.getByRole('combobox', { name: 'Карточка пациента' }).fill(name);
  await page.getByRole('option', { name }).click();
}

/** Confirms the child sheet and waits for it to slide away. */
async function closeChildSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The tile of a status group shows its count; `now` and `overdue` follow the child's age. */
async function counts(page: Page): Promise<Record<string, number>> {
  const tiles = page.locator('.vax-status__tile');
  const result: Record<string, number> = {};
  for (const tile of await tiles.all()) {
    const status = (await tile.getAttribute('data-status')) ?? '';
    result[status] = Number(await tile.locator('.vax-status__count').textContent());
  }
  return result;
}

function dose(page: Page, itemId: string) {
  return page.locator(`.vax-chart__dose[data-item-id="${itemId}"]`).first();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('patient: the child row, statuses, marks kept with the card, and the handout for the mother', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.clock.setFixedTime(TODAY);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await createPatient(page, 'Аня Тестова', '2026-01-10');
  await createPatient(page, 'Миша без даты');
  await openCalendar(page);

  // Nothing chosen: the row asks for a child, there are no statuses and no tiles.
  await expect(page.locator('.vax-child__name')).toHaveText('Ребёнок');
  await expect(page.locator('.vax-status')).toHaveCount(0);
  await expect(page.locator('.vax-chart__now')).toHaveCount(0);

  // Chosen: avatar, full name, birth date and age in one row, then the tiles and the «now» line.
  await chooseChild(page, 'Аня Тестова');
  await expect(page.locator('.vax-child__name')).toHaveText('Аня Тестова');
  await expect(page.locator('.vax-child__birth')).toHaveText('10.01.2026 · 8 мес.');
  await expect(page.getByRole('button', { name: 'Сменить ребёнка' })).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ done: 0, planned: 0, now: 4, overdue: 11 });
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'overdue');
  await expect(dose(page, 'n-07-1')).toHaveAttribute('data-status', 'now');
  await expect(dose(page, 'n-08-1')).toHaveAttribute('data-status', 'later');
  // A risk-group vaccination is not due for every child.
  await expect(dose(page, 'n-04-1')).toHaveAttribute('data-status', 'optional');
  await expect(page.locator('.vax-chart__now')).toHaveCount(1);
  await expect(page.locator('.vax-chart__age--now')).toHaveCount(1);
  await expect(page.locator('.vax-chart__age--now')).toHaveAttribute('data-row-id', 'n-07');
  // The line is brought into view: it is inside the scrolling table's visible width.
  const inView = await page.evaluate(() => {
    const scroller = document.querySelector('.vax-chart__scroller');
    const line = document.querySelector('.vax-chart__now');
    if (!scroller || !line) return false;
    const box = scroller.getBoundingClientRect();
    const x = line.getBoundingClientRect().x;
    return x > box.x && x < box.right;
  });
  expect(inView).toBe(true);
  await noHorizontalOverflow(page);
  await capture(page, 'vac3-chosen-390');

  // A tap cycles done → planned → empty; one vaccination for three infections is marked once.
  await dose(page, 'n-05-1').click();
  await expect(dose(page, 'n-05-1')).toHaveAttribute('data-status', 'done');
  await expect(
    page.locator('.vax-chart__dose[data-item-id="n-05-1"][data-status="done"]'),
  ).toHaveCount(3);
  await expect.poll(() => counts(page)).toMatchObject({ done: 1, overdue: 10 });
  await dose(page, 'n-05-1').click();
  await expect(dose(page, 'n-05-1')).toHaveAttribute('data-status', 'planned');
  await expect.poll(() => counts(page)).toMatchObject({ done: 0, planned: 1, overdue: 10 });
  await dose(page, 'n-05-1').click();
  await expect(dose(page, 'n-05-1')).toHaveAttribute('data-status', 'overdue');

  // A right click (a long press on a phone) opens the age with the date of the mark.
  await dose(page, 'n-01-1').click();
  await dose(page, 'n-05-2').click({ button: 'right' });
  const sheet = page.getByRole('dialog', { name: '3 месяца' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('10.04.2026');
  const polio = sheet.locator('.vax-dose[data-item-id="n-05-2"]');
  await expect(polio).toHaveClass(/vax-dose--focused/u);
  await polio.locator('label', { hasText: 'Сделана' }).click();
  await polio.getByLabel('Дата прививки').fill('2026-04-12');
  await polio.getByLabel('Дата прививки').blur();
  await capture(page, 'vac3-age-sheet-390');
  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dose(page, 'n-05-2')).toHaveAttribute('data-status', 'done');

  // A tile picks its group out in the chart.
  await page
    .getByRole('button', { name: /Просрочено/u })
    .first()
    .click();
  await expect(page.locator('.vax-chart__dose--dimmed').first()).toBeVisible();
  await expect(
    page.locator('.vax-chart__dose[data-status="overdue"].vax-chart__dose--dimmed'),
  ).toHaveCount(0);
  await expect(dose(page, 'n-07-1')).toHaveClass(/vax-chart__dose--dimmed/u);
  await page
    .getByRole('button', { name: /Просрочено/u })
    .first()
    .click();
  await expect(page.locator('.vax-chart__dose--dimmed')).toHaveCount(0);

  // Everything overdue as done in one tap, with an undo.
  const before = await counts(page);
  await page.getByRole('button', { name: 'Отметить просроченные как сделанные' }).click();
  await expect.poll(() => counts(page)).toMatchObject({ overdue: 0, now: 4 });
  await capture(page, 'vac3-all-done-390');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(() => counts(page)).toEqual(before);

  // The marks are saved with the card: leave, come back, choose the card again.
  await page.waitForTimeout(900);
  await leaveCalendar(page);
  await openCalendar(page);
  await expect(page.locator('.vax-status')).toHaveCount(0);
  await chooseChild(page, 'Аня Тестова');
  await expect.poll(() => counts(page)).toEqual(before);
  await expect(dose(page, 'n-05-2')).toHaveAttribute('data-status', 'done');
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'done');

  // The handout: one A4 portrait page in plain words with the name, the marks and dates.
  await page.getByRole('button', { name: 'Печать', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Лист для мамы' });
  await expect(dialog).toBeVisible();
  const frame = page.frameLocator('iframe[title="Предпросмотр листа для мамы"]');
  await expect(frame.locator('.handout__value').first()).toHaveText('Аня Тестова');
  await expect(frame.locator('.handout__value').nth(1)).toContainText('10.01.2026');
  await expect(frame.locator('.handout__dose')).toContainText([
    'Вирусный гепатит В — 1-я прививка',
  ]);
  await expect(frame.getByText('сделана 12.04.2026')).toBeVisible();
  await expect(frame.locator('.handout__box--done')).toHaveCount(2);
  await expect(frame.locator('body')).not.toContainText('клинич');
  await capture(page, 'vac3-handout-390');

  const html = (await page
    .locator('iframe[title="Предпросмотр листа для мамы"]')
    .getAttribute('srcdoc')) as string;
  const sheetPage = await page.context().newPage();
  try {
    await sheetPage.setContent(html);
    await sheetPage.emulateMedia({ media: 'print' });
    const pdf = await sheetPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const source = pdf.toString('latin1');
    const pages = (source.match(/\/Type\s*\/Page(?![a-z])/gu) ?? []).length;
    expect(pages).toBe(1);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(source);
    expect(Number(box?.[1])).toBeCloseTo(595.28, 0);
    expect(Number(box?.[2])).toBeCloseTo(841.89, 0);
    if (CAPTURE_DIR) {
      mkdirSync(CAPTURE_DIR, { recursive: true });
      writeFileSync(`${CAPTURE_DIR}/vac3-handout.pdf`, pdf);
    }
  } finally {
    await sheetPage.close();
  }
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

  // A card without a birth date: marks work, statuses wait for the date, which goes into the card.
  await chooseChild(page, 'Миша без даты');
  // The sheet stays open to ask for the date; the marks work without it.
  await closeChildSheet(page);
  await expect(page.locator('.vax-child__birth')).toHaveText('дата рождения не указана');
  await expect(page.locator('.vax-status')).toHaveCount(0);
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'later');
  await dose(page, 'n-01-1').click();
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'done');
  await page.getByRole('button', { name: 'Сменить ребёнка' }).click();
  await page.getByLabel('Дата рождения (запишется в карточку)').fill('2026-01-10');
  await closeChildSheet(page);
  await expect(page.locator('.vax-child__birth')).toHaveText('10.01.2026 · 8 мес.');
  await expect.poll(() => counts(page)).toMatchObject({ done: 1, now: 4, overdue: 10 });
  // The card keeps the date: another card and back again.
  await chooseChild(page, 'Аня Тестова');
  await chooseChild(page, 'Миша без даты');
  await expect(page.locator('.vax-child__birth')).toHaveText('10.01.2026 · 8 мес.');
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'done');

  // Patient data is not left outside the vault.
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(stored).not.toContain('Аня Тестова');
  expect(stored).not.toContain('2026-01-10');
  expect(page.url()).not.toContain('2026-01-10');
});

test('birth date only: statuses and marks without a card, nothing is saved', async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(TODAY);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openCalendar(page);

  await page.getByRole('button', { name: 'Выбрать ребёнка' }).click();
  const birth = page.getByLabel('Или только дата рождения');
  await birth.fill('2026-01-10');
  await closeChildSheet(page);
  await expect(page.locator('.vax-child__name')).toHaveText('Без карточки');
  await expect(page.locator('.vax-child__birth')).toHaveText('10.01.2026 · 8 мес.');
  await expect.poll(() => counts(page)).toEqual({ done: 0, planned: 0, now: 4, overdue: 11 });
  await dose(page, 'n-01-1').click();
  await expect.poll(() => counts(page)).toMatchObject({ done: 1, overdue: 10 });
  await noHorizontalOverflow(page);
  await capture(page, 'vac3-quick-390');

  // The handout has a blank line for the name and the date.
  await page.getByRole('button', { name: 'Печать', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Предпросмотр листа для мамы"]');
  await expect(frame.locator('.handout__value').first()).toHaveText('');
  await expect(frame.locator('.handout__value').nth(1)).toContainText('10.01.2026');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(stored).not.toContain('2026-01-10');
  expect(page.url()).not.toContain('2026-01-10');
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ''),
  );
  expect(databases.filter((name) => /patient/iu.test(name))).toEqual([]);

  // A date that cannot be used is explained; a cleared child leaves the plain table.
  await page.getByRole('button', { name: 'Сменить ребёнка' }).click();
  await birth.fill('2099-01-01');
  await closeChildSheet(page);
  await expect(page.getByRole('alert')).toContainText('не может быть позже сегодняшнего дня');
  await page.getByRole('button', { name: 'Сменить ребёнка' }).click();
  await page.getByRole('button', { name: 'Убрать' }).click();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.vax-child__name')).toHaveText('Ребёнок');
  await expect(page.locator('.vax-status')).toHaveCount(0);
  await expect(dose(page, 'n-01-1')).toHaveAttribute('data-status', 'later');
});

test('desktop: the table, tiles and the «now» line at full width', async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(TODAY);
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await openCalendar(page);
  await page.getByRole('button', { name: 'Выбрать ребёнка' }).click();
  await page.getByLabel('Или только дата рождения').fill('2026-01-10');
  await closeChildSheet(page);
  await expect.poll(() => counts(page)).toMatchObject({ now: 4, overdue: 11 });
  await noHorizontalOverflow(page);
  await capture(page, 'vac3-chosen-1280');
});
