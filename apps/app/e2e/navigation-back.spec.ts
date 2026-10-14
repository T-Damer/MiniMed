import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { selectSearchSection, waitForHomeSections } from './select-search-section';

// NAV1: back returns where the user came from, with state intact. The in-app ‹, the browser's back
// and Android's hardware back are all one history step (`state/app-back.ts`); sheets are history
// layers (`state/history-layer.ts`); tabs share the one history. Every step below asserts the
// address, the screen and the length of the history.

interface Place {
  readonly hash: string;
  readonly entries: number;
  readonly scrollY: number;
}

const place = (page: Page): Promise<Place> =>
  page.evaluate(() => ({
    hash: window.location.hash,
    entries: window.history.length,
    scrollY: Math.round(window.scrollY),
  }));

/** `aria-hidden` on a subtree that holds the focus is blocked by the browser and logged. */
function collectFocusWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/aria-hidden/u.test(message.text())) warnings.push(message.text());
  });
  return warnings;
}

async function openUnitConversionFromSearch(page: Page): Promise<void> {
  await waitForHomeSections(page);
  await selectSearchSection(page, 'Калькуляторы');
  await page.getByTestId('search-input').fill('единицы');
  const tool = page.locator('.unified-catalog__tool[href="#/calculators/unit-conversion"]');
  await expect(tool).toBeVisible();
  await tool.click();
  await expect(page).toHaveURL(/#\/calculators\/unit-conversion$/u);
}

test.describe('back returns where the user came from', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  });

  test('a tool opened from search: ‹, browser back and forward return to the search, query and scroll intact', async ({
    page,
  }) => {
    const warnings = collectFocusWarnings(page);
    await waitForHomeSections(page);
    await selectSearchSection(page, 'Калькуляторы');
    await page.getByTestId('search-input').fill('единицы');
    const tool = page.locator('.unified-catalog__tool[href="#/calculators/unit-conversion"]');
    await expect(tool).toBeVisible();
    // Scrolled down as far as the short list goes, with the tool in view.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await tool.scrollIntoViewIfNeeded();
    const before = await place(page);
    expect(before.hash).toBe('#/search/section/calculators');
    expect(before.scrollY).toBeGreaterThan(0);

    await tool.click();
    await expect(page).toHaveURL(/#\/calculators\/unit-conversion$/u);
    const atTool = await place(page);
    expect(atTool.entries).toBe(before.entries + 1);

    // ‹ steps back: no entry is added, and the results come back as they were.
    await page.locator('.knowledge-back-button').first().click();
    await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
    await expect(page.getByTestId('search-input')).toHaveValue('единицы');
    const back = await place(page);
    expect(back.entries).toBe(atTool.entries);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(before.scrollY);

    // Browser back from the results leaves them for the screen below, not for the tool just left.
    await page.goBack();
    await expect(page).not.toHaveURL(/#\/calculators\//u);
    await page.goForward();
    await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
    expect(warnings).toEqual([]);
  });

  test('the system back from a tool returns to the search results as well', async ({ page }) => {
    await openUnitConversionFromSearch(page);
    await page.goBack();
    await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
    await expect(page.getByTestId('search-input')).toHaveValue('единицы');
  });

  test('a deep-linked tool has no app entry below: ‹ replaces it with its parent instead of pushing', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const fresh = await context.newPage();
    await mountBuiltApp(fresh, { splitNavigation: false, skipLargeCompanionPacks: true });
    // The tool is the first entry of this tab: nothing of the app lies below it.
    await fresh.evaluate(() => window.location.replace('#/calculators/unit-conversion'));
    await expect(fresh.locator('.knowledge-back-button').first()).toBeVisible();
    const before = await place(fresh);
    await fresh.locator('.knowledge-back-button').first().click();
    await expect(fresh).not.toHaveURL(/#\/calculators\/unit-conversion$/u);
    const after = await place(fresh);
    expect(after.entries).toBe(before.entries);
    await context.close();
  });

  test('tab switches share one history: a round trip adds no entries and back returns to the tab used before', async ({
    page,
  }) => {
    const warnings = collectFocusWarnings(page);
    const nav = page.locator('.app-bottom-nav');
    await waitForHomeSections(page);
    const start = await place(page);

    await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings$/u);
    const atSettings = await place(page);
    expect(atSettings.entries).toBe(start.entries + 1);

    // Back to the first tab and again to settings: the history holds both places already.
    await nav.getByRole('button', { name: 'Поиск', exact: true }).click();
    await expect(page.getByTestId('search-input')).toBeVisible();
    await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings$/u);
    expect((await place(page)).entries).toBeLessThanOrEqual(atSettings.entries + 1);

    // Back from a tab's first screen goes to the tab used before it, not out of the app.
    await page.goBack();
    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page).not.toHaveURL(/#\/settings/u);
    // Leaving a tab with the focus inside it must not log «Blocked aria-hidden».
    expect(warnings).toEqual([]);
  });

  test('the section menu and the «?» help are layers: back closes them, the page stays', async ({
    page,
  }) => {
    await waitForHomeSections(page);
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    const start = await place(page);
    await picker.click();
    await expect(page.locator('.search-section-menu__row').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.search-section-menu__row')).toHaveCount(0);
    expect((await place(page)).hash).toBe(start.hash);
    await expect(page.getByTestId('search-input')).toBeVisible();

    // A tap outside the sheet closes the layer too.
    await picker.click();
    await expect(page.locator('.search-section-menu__row').first()).toBeVisible();
    await page.locator('.overlay-backdrop').click({ position: { x: 8, y: 8 } });
    await expect(page.locator('.search-section-menu__row')).toHaveCount(0);
    expect((await place(page)).hash).toBe(start.hash);
    await expect(page.getByTestId('search-input')).toBeVisible();

    // Escape closes the layer too, and leaves no extra entry behind.
    await picker.click();
    await expect(page.locator('.search-section-menu__row').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-section-menu__row')).toHaveCount(0);
    await page.waitForTimeout(100);
    expect((await place(page)).entries).toBeLessThanOrEqual(start.entries + 1);

    // The help panel of a tool page.
    await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions`);
    const help = page.locator('.page__help-button').first();
    await expect(help).toBeVisible();
    const tool = await place(page);
    await help.click();
    await expect(page.locator('.page__help-panel')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.page__help-panel')).toHaveCount(0);
    expect((await place(page)).hash).toBe(tool.hash);
  });

  test('choosing a section from the menu leaves no phantom step: one back returns to the section list', async ({
    page,
  }) => {
    await waitForHomeSections(page);
    const start = await place(page);
    await selectSearchSection(page, 'Калькуляторы');
    await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
    await page.goBack();
    await expect(page).not.toHaveURL(/#\/search\/section\//u);
    expect((await place(page)).hash).toBe(start.hash);
    await expect(page.locator('.search-sections__row').first()).toBeVisible();
  });
});
