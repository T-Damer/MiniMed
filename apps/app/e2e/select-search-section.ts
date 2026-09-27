import type { Page } from '@playwright/test';

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
