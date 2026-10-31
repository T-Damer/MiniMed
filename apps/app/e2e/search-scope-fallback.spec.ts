import { mountBuiltApp, waitForSearchEditable } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

import { selectSearchSection } from './select-search-section';

// Roadmap item 23: a search inside one section that finds nothing is repeated over all sources.
// One line says the section found nothing, the hits follow under «Результаты раздела «…»:» each,
// the picked section stays in the picker, and a tap on a subheader opens that section with the
// same words.
test('an empty section search shows the other sections under subheaders', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);
  const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });

  await selectSearchSection(page, 'Нормативные документы');
  await input.fill('аменция');
  await page.getByTestId('search-submit').click();

  const miss = page.getByTestId('scope-fallback-miss');
  await expect(miss).toHaveText(
    'Поиск по запросу «аменция» не дал результатов в разделе «Нормативные документы»',
    { timeout: 60_000 },
  );
  const headings = page.getByTestId('scope-fallback-heading');
  await expect(headings.first()).toHaveText(/^Результаты раздела «.+»:$/u);
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/аменция/iu)
      .first(),
  ).toBeVisible();
  // The nothing-found card does not appear next to results, and the picked section stays.
  await expect(page.getByText('Ничего не найдено')).toHaveCount(0);
  await expect(picker.locator('.search-source-picker__label')).toContainText(
    'Нормативные документы',
  );

  // A tap on a subheader opens that section and keeps the words.
  const label = (await headings.first().innerText()).replace(/^Результаты раздела «|»:$/gu, '');
  await headings.first().click();
  await expect(picker.locator('.search-source-picker__label')).toContainText(label, {
    timeout: 30_000,
  });
  await expect(input).toHaveValue('аменция');
  await expect(page.getByTestId('scope-fallback')).toHaveCount(0);
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/аменция/iu)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
});

test('a section that finds something is never widened', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);

  await selectSearchSection(page, 'Клинические рекомендации');
  await input.fill('пневмония');
  await page.getByTestId('search-submit').click();
  await expect(
    page
      .getByTestId('search-results')
      .getByText(/пневмони/iu)
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('scope-fallback')).toHaveCount(0);
});

test('nothing found anywhere keeps the nothing-found card', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await waitForSearchEditable(page);

  await selectSearchSection(page, 'Нормативные документы');
  await input.fill('ъъъъъъъъъъ');
  await page.getByTestId('search-submit').click();
  await expect(page.getByText('Ничего не найдено')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('scope-fallback')).toHaveCount(0);
});
