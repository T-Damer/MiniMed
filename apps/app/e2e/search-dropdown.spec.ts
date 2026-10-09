import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { selectSearchSection } from './select-search-section';

for (const width of [375, 1280]) {
  test(`dropdown controls, empty sections and tool origins at ${width}px`, async ({ page }) => {
    // The first catalog waits for the 440 MB core to open, which takes long on a busy machine.
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    await picker.click();
    const menu = page.getByRole('dialog', { name: 'Разделы поиска' });
    const query = menu.getByRole('searchbox', { name: 'Найти раздел или подраздел' });
    await expect(menu.locator('.archive-search__icon')).toBeVisible();
    await query.fill('Гинекология');
    await expect(menu.locator('.archive-search__clear-icon')).toBeVisible();
    await menu.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
    await expect(query).toHaveValue('');
    // Rows sit in an overlay-scrollbar viewport: Playwright's click scrolls the page to reach them
    // while the menu is still settling, which a person never does and which closes the menu.
    await menu.getByRole('link', { name: 'Загрузки', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/#\/settings\/downloads$/u);
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: 'Поиск', exact: true })
      .click();
    await selectSearchSection(page, 'Клинические рекомендации');
    await expect(page.getByTestId('search-input')).toHaveValue('');
    await expect(page.locator('.document-library-card').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.document-library-card .clinical-tags__icon').first()).toBeVisible();

    await selectSearchSection(page, 'МКБ, симптомы и состояния');
    await picker.click();
    await menu
      .getByRole('button', { name: 'Подразделы: МКБ, симптомы и состояния', exact: true })
      .dispatchEvent('click');
    for (const name of ['Коды и рубрики МКБ', 'Симптомы', 'Состояния', 'Синдромы', 'Заболевания']) {
      await expect(
        menu.getByRole('button', { name: new RegExp(`^${name} \\(`, 'u') }),
      ).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('dropdown-entity-filters.png') });
    await menu.getByRole('button', { name: /^Симптомы \(/u }).click();
    await expect(picker).toContainText('Симптомы');
    await expect(page.locator('.unified-catalog__tool')).toHaveCount(0);

    await selectSearchSection(page, 'Калькуляторы');
    await page.getByTestId('search-input').fill('Единицы');
    await page.locator('.unified-catalog__tool').first().click();
    await expect(page).toHaveURL(/#\/calculators\//u);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    // An open section is a page of its own (UX7): back from a tool returns to that section's page.
    await expect(page).toHaveURL(/#\/search(?:\/section\/calculators)?$/u);
    await expect(page.getByTestId('search-input')).toHaveValue('Единицы');
    await expect(picker).toContainText('Калькуляторы');

    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: 'Калькуляторы', exact: true })
      .click();
    // The tab always opens the list (2026-10-09) with the calculator used last in a compact row;
    // Back from a calculator still returns to the place it was opened from.
    await expect(page).toHaveURL(/#\/calculators$/u);
    await expect(page.getByRole('heading', { name: 'Калькуляторы', level: 1 })).toBeVisible();
    const recent = page.getByTestId('recent-calculators');
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('button')).toHaveCount(1);
    await expect(recent).toContainText('Единицы');
    await recent.getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'Преобразование единиц' })).toBeVisible();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/#\/calculators$/u);
    await page.getByRole('button', { name: 'Открыть раздел «Преобразование единиц»' }).click();
    const origin = page.url();
    await page.locator('[data-testid^="calculator-open-"]').first().click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(origin);
  });
}
