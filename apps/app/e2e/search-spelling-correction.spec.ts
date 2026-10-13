import { mountBuiltApp, waitForSearchEditable } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

// A word misspelt in its first letters finds the name it meant; the box shows the wrong letter
// struck out and the right one added, and a tap puts the corrected word in the box.
test('a misspelt first letter is corrected in the search box', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);

  await input.fill('оменция');
  await page.getByTestId('search-submit').click();
  const correction = page.getByTestId('search-correction');
  await expect(correction).toBeVisible({ timeout: 30_000 });
  await expect(correction.locator('.search-correction__piece--removed')).toHaveText('о');
  await expect(correction.locator('.search-correction__piece--added')).toHaveText('а');
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/аменция/iu)
      .first(),
  ).toBeVisible();

  await correction.click();
  await expect(input).toHaveValue('аменция');
  await expect(correction).toHaveCount(0);

  await input.fill('аменция');
  await page.getByTestId('search-submit').click();
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/аменция/iu)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('search-correction')).toHaveCount(0);
});
