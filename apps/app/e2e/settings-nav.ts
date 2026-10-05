import type { Page } from '@playwright/test';

/** Opens a Settings sub-page through its row in the list, like a user would. */
export async function openSettingsPage(page: Page, title: string): Promise<void> {
  const row = page.getByRole('link', { name: new RegExp(`^${title}`, 'u') });
  // A sub-page left open earlier hides the list on a phone; the root route shows it again.
  if (!(await row.isVisible())) {
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
  }
  await row.click();
}
