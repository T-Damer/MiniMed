import type { Page } from '@playwright/test';

export async function selectSearchSection(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
  await page
    .locator('.search-section-menu__row')
    .getByRole('button', { name: new RegExp(`^${label}(?: \\(|$)`, 'u') })
    .click();
}
