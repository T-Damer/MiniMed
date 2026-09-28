import { expect, type Page } from '@playwright/test';

export async function selectSearchSection(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
  await page
    .locator('.search-section-menu__row')
    .getByRole('button', { name: new RegExp(`^${label}(?: \\(|$)`, 'u') })
    .click();
}

/** Clinical analysis is a switch next to the source picker, not a source of its own. */
export async function setClinicalAnalysis(page: Page, on: boolean): Promise<void> {
  const control = page.getByRole('switch', { name: 'Клинический разбор' });
  if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
}

/** The empty home lists sections with counts; the counts appear once the catalog has loaded. */
export async function waitForHomeSections(page: Page): Promise<void> {
  await expect(page.locator('.search-sections__row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.search-sections__count', { hasText: 'считаем' })).toHaveCount(0, {
    timeout: 60_000,
  });
}

/** Opens a section's catalog from the home section list. */
export async function openHomeSection(page: Page, label: string): Promise<void> {
  await waitForHomeSections(page);
  await page.locator('.search-sections__row', { hasText: label }).click();
}
