import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

// A name typed on the wrong keyboard layout or in Latin letters finds the source document and the
// page says which spelling was searched; a name that already matches is searched as typed.
test('a layout slip and a Latin spelling find the drug and name the spelling searched', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toBeEnabled({ timeout: 60_000 });

  for (const typed of ['ьуеащкьшт', 'metformin']) {
    await input.fill(typed);
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-rewrite-note')).toContainText('метформин', {
      timeout: 30_000,
    });
    await expect(
      page
        .getByTestId('search-results')
        .getByText(/метформин/iu)
        .first(),
    ).toBeVisible();
  }

  await input.fill('метформин');
  await page.getByTestId('search-submit').click();
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/метформин/iu)
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId('search-rewrite-note')).toHaveCount(0);
});
