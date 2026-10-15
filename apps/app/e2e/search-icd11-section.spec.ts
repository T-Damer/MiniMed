import { expect, type Locator, type Page, test } from '@playwright/test';

import { ICD11_RESULT_LABEL, installIcd11Module, routeIcd11Module } from './icd11-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchReady } from './mount-built-app';
import { openHomeSection, selectSearchSection, waitForHomeSections } from './select-search-section';

/**
 * The «МКБ-11» search section (owner decision 2026-10-15): its own scope beside «МКБ, симптомы и
 * состояния», sized in entries by the catalog, offered for download until the pack is installed, and
 * added to the «Все источники» total. The installed-pack tests need the locally built release file.
 */
const SECTION = 'МКБ-11';

/** «37 052 записи» → 37052. */
function leadingNumber(text: string): number {
  const digits = /^[\d\s  ]+/u.exec(text.trim())?.[0].replace(/\D/gu, '');
  if (!digits) throw new Error(`No leading number in «${text}»`);
  return Number(digits);
}

/** The counters of the home section rows, by section name. */
async function homeCounts(page: Page): Promise<ReadonlyMap<string, number>> {
  await waitForHomeSections(page);
  const rows = await page.locator('.search-sections__row').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.querySelector('.search-sections__name')?.textContent ?? '',
      count: element.querySelector('.search-sections__count')?.textContent ?? '',
    })),
  );
  return new Map(rows.map((row) => [row.name, leadingNumber(row.count)]));
}

/** «Все источники (N)» as the section picker prints it. */
async function allSourcesTotal(page: Page): Promise<number> {
  const label = page
    .getByRole('button', { name: 'Раздел поиска', exact: true })
    .locator('.search-source-picker__label');
  await expect(label).toContainText('Все источники (');
  const text = (await label.innerText()).replace(/\s+/gu, ' ');
  const match = /\(([\d\s  ]+)\)/u.exec(text);
  if (!match?.[1]) throw new Error(`No total in «${text}»`);
  return leadingNumber(match[1]);
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId('search-input').fill(query);
  await page.getByTestId('search-submit').click();
}

function icd11Group(page: Page, code: string): Locator {
  return page
    .getByTestId('search-results')
    .locator('.result-group')
    .filter({
      has: page.locator('.result-group-header__kind-label', { hasText: ICD11_RESULT_LABEL }),
    })
    .filter({ has: page.locator('.result-group-header__title', { hasText: code }) })
    .first();
}

// The module can finish mounting after the first results are shown; those then wait behind
// «Обновить» instead of changing under the reader, so the test applies the offer like a person.
async function expectGroupAfterRefresh(page: Page, group: Locator): Promise<void> {
  await expect(async () => {
    const apply = page.getByTestId('search-refresh-apply');
    if (await apply.isVisible()) await apply.click();
    await expect(group).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
}

test('lists «МКБ-11» with the catalog count, offers the download and adds it to «Все источники»', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const counts = await homeCounts(page);
  // Entries, named as such, and the same number whatever is installed.
  const row = page.locator('.search-sections__row', {
    has: page.locator('.search-sections__name', { hasText: new RegExp(`^${SECTION}$`, 'u') }),
  });
  await expect(row.locator('.search-sections__count')).toHaveText(/^37\s052\sзаписи$/u);
  expect(counts.get(SECTION)).toBeGreaterThan(30_000);

  // «Все источники» is the sum of the section counters, МКБ-11 included.
  await expect
    .poll(() => allSourcesTotal(page), { timeout: 60_000 })
    .toBe([...counts.values()].reduce((sum, value) => sum + value, 0));

  await openHomeSection(page, SECTION);
  await expect(page).toHaveURL(/#\/search\/section\/icd11$/u);
  const offer = page.locator('.search-icd11-offer');
  await expect(offer).toBeVisible({ timeout: 60_000 });
  const download = offer.getByRole('button', { name: /^Скачать МКБ-11/u });
  await expect(download).toBeVisible();
  await expect(download).toContainText(/МБ/u);
  // One screen at 375 px: the offer sits at the top of the section, not below a list.
  await expect(page.getByTestId('search-input')).toHaveAttribute(
    'placeholder',
    'Код МКБ-11 или название',
  );

  // Back peels the section off, one history step.
  await page.goBack();
  await expect(page).toHaveURL(/#\/search$/u);
  await waitForHomeSections(page);
});

test('searches inside the section without the pack: nothing found, the pack is offered, the section is remembered', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  await selectSearchSection(page, SECTION);
  await search(page, 'BA41');
  const none = page.locator('.search-no-results');
  await expect(none).toBeVisible({ timeout: 60_000 });
  await expect(none.getByRole('button', { name: /Скачать: МКБ-11/u })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const history = JSON.parse(localStorage.getItem('localmed.search-history.v4') ?? '[]');
        return history[0]?.scope;
      }),
    )
    .toBe('icd11');
});

test('finds ICD-11 codes and words, opens the card and returns to the section with the query', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await routeIcd11Module(page);
  await mountBuiltApp(page, { persistentOrigin: true, splitNavigation: false });
  await installIcd11Module(page);

  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchReady(page);
  const counts = await homeCounts(page);
  await openHomeSection(page, SECTION);
  await expect(page).toHaveURL(/#\/search\/section\/icd11$/u);
  // No download offer once installed; the section opens on the chapters, not on 37 000 codes.
  await expect(page.locator('.search-icd11-offer')).toHaveCount(0);
  const chapters = page.locator('.document-library-card');
  await expect(chapters.first()).toBeVisible({ timeout: 60_000 });
  await expect(chapters.first()).toContainText('Глава 01');
  await expect(chapters.nth(1)).toContainText('Глава 02');
  // The list is virtualized: only chapters, never a code card, are in it.
  await expect(chapters.filter({ hasText: /^\d+.*Глава /u })).not.toHaveCount(0);
  await expect(chapters.filter({ hasText: 'BA41' })).toHaveCount(0);

  // A code leads, whatever the letter case; a word finds the rubric by its Russian name.
  await search(page, 'ba41');
  const ami = icd11Group(page, 'BA41');
  await expectGroupAfterRefresh(page, ami);
  await expect(page.getByTestId('search-results').locator('.result-group').first()).toContainText(
    'BA41',
  );
  await search(page, 'холера');
  await expectGroupAfterRefresh(page, icd11Group(page, '1A00'));
  await search(page, 'BA41');
  await expectGroupAfterRefresh(page, icd11Group(page, 'BA41'));

  // The card opens, and back returns to the section with the typed code in the field.
  await icd11Group(page, 'BA41').locator('.result-group-header').click();
  await expect(page.getByTestId('icd11-card-panel')).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page.getByTestId('icd11-card-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/search\/section\/icd11\?q=BA41$/u);
  await expect(page.getByTestId('search-input')).toHaveValue('BA41');

  // The count of the section does not change with the install, and the total still adds up.
  await page.goBack();
  await waitForHomeSections(page);
  const after = await homeCounts(page);
  expect(after.get(SECTION)).toBe(counts.get(SECTION));
  await expect
    .poll(() => allSourcesTotal(page), { timeout: 60_000 })
    .toBe([...after.values()].reduce((sum, value) => sum + value, 0));
});

test('keeps ICD-11 out of the ICD-10 section and of the clinical analysis', async ({ page }) => {
  test.setTimeout(420_000);
  await routeIcd11Module(page);
  await mountBuiltApp(page, { persistentOrigin: true, splitNavigation: false });
  await installIcd11Module(page);

  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchReady(page);
  await selectSearchSection(page, 'МКБ, симптомы и состояния');
  await search(page, '1A00 холера');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.locator('.result-group-header__kind-label', { hasText: ICD11_RESULT_LABEL }),
  ).toHaveCount(0);

  await selectSearchSection(page, SECTION);
  await search(page, '1A00 холера');
  await expectGroupAfterRefresh(page, icd11Group(page, '1A00'));
  // Every card of the section is an ICD-11 card.
  const labels = page.locator('.result-group-header__kind-label');
  await expect(labels.first()).toBeVisible();
  const kinds = await labels.allInnerTexts();
  expect(kinds.every((text) => text.includes(ICD11_RESULT_LABEL))).toBe(true);
});
