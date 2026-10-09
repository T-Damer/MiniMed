import { expect, type Page } from '@playwright/test';

export async function selectSearchSection(page: Page, label: string): Promise<void> {
  const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
  // A pointer click scrolls the row into view, and that scroll can close the menu before the
  // choice lands; dispatch the click and confirm the picker shows the section before going on.
  await expect(async () => {
    if ((await page.locator('.search-section-menu__row').count()) === 0) await picker.click();
    await page
      .locator('.search-section-menu__row')
      .getByRole('button', { name: new RegExp(`^${label}(?: \\(|$)`, 'u') })
      .dispatchEvent('click', undefined, { timeout: 2000 });
    await expect(picker.locator('.search-source-picker__label')).toContainText(label, {
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Clinical analysis is an icon toggle next to the source picker, not a source of its own. */
export async function setClinicalAnalysis(page: Page, on: boolean): Promise<void> {
  const control = page.getByRole('button', { name: 'Клинический разбор', exact: true });
  if ((await control.getAttribute('aria-pressed')) !== String(on)) await control.click();
  await expect(control).toHaveAttribute('aria-pressed', String(on));
}

/** The empty home lists sections with their catalog counts, which need no loading. */
export async function waitForHomeSections(page: Page): Promise<void> {
  await expect(page.locator('.search-sections__row').first()).toBeVisible({ timeout: 30_000 });
}

/** Opens a section's catalog from the home section list. */
export async function openHomeSection(page: Page, label: string): Promise<void> {
  await waitForHomeSections(page);
  await page.locator('.search-sections__row', { hasText: label }).click();
}
