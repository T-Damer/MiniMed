import { expect, type Page, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// NAV1: search results come back at the place they were left (the QA pass saw 900 → 0), through
// the in-app ‹, the browser's back, and a tab round trip; the results load late, so the restore
// keeps the page at the remembered place until the layout is still.

const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));

test.describe('scroll restoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
    await waitForSearchEditable(page);
    await page.getByTestId('search-input').fill('пневмония');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.result-group-header').nth(6)).toBeAttached({ timeout: 60_000 });
  });

  async function openLowerResult(
    page: Page,
  ): Promise<{ readonly left: number; readonly url: string }> {
    const result = page.locator('.result-group-header').nth(6);
    await result.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 40));
    await page.waitForTimeout(400);
    const left = await scrollY(page);
    expect(left).toBeGreaterThan(300);
    const url = page.url();
    // A pointer click would first scroll the header out from under the sticky chrome.
    await result.dispatchEvent('click');
    await expect.poll(() => page.url()).not.toBe(url);
    return { left, url };
  }

  test('the browser back returns the results at the same scroll', async ({ page }) => {
    const { left } = await openLowerResult(page);
    await page.goBack();
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect.poll(() => scrollY(page), { timeout: 15_000 }).toBeGreaterThan(left - 6);
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(6);
  });

  test('the in-app ‹ returns the results at the same scroll, and a tab round trip as well', async ({
    page,
  }) => {
    const { left } = await openLowerResult(page);
    await page.getByRole('button', { name: 'Назад' }).first().click();
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect.poll(() => scrollY(page), { timeout: 15_000 }).toBeGreaterThan(left - 6);
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(6);

    // Another tab and back: the results are where they were left.
    const nav = page.locator('.app-bottom-nav');
    await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings$/u);
    await nav.getByRole('button', { name: 'Поиск', exact: true }).click();
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect.poll(() => scrollY(page), { timeout: 15_000 }).toBeGreaterThan(left - 6);
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(6);
  });
});
