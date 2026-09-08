import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { selectSearchSection } from './select-search-section';

test('keeps source and tool lookup together and restores the six-section layout on request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const nav = page.locator('.app-bottom-nav');
  await expect(nav.locator('.app-nav-button')).toHaveCount(3);
  const mode = page.getByRole('button', { name: 'Раздел поиска', exact: true });
  const input = page.getByTestId('search-input');
  await expect(page.locator('.unified-catalog .document-library-card').first()).toBeVisible();
  await selectSearchSection(page, 'Калькуляторы');
  await input.fill('единицы');
  const units = page.locator('.unified-catalog__tool[href="#/calculators/unit-conversion"]');
  await expect(units).toBeVisible();
  await units.click();
  await expect(page).toHaveURL(/#\/calculators\//u);
  await nav.getByRole('button', { name: 'Поиск', exact: true }).click();
  await expect(mode).toContainText('Калькуляторы');
  await expect(input).toHaveValue('единицы');
  await page.screenshot({ path: test.info().outputPath('unified-calculators-phone.png') });
  await selectSearchSection(page, 'Опросники');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('link', { name: /^Создать свой опросник/u })).toBeVisible();
  await input.fill('Командные роли');
  await expect(
    page.locator('.unified-catalog__tool').filter({ hasText: 'Командные роли' }).first(),
  ).toBeVisible();
  await selectSearchSection(page, 'Калькуляторы');
  await expect(input).toHaveValue('единицы');
  await selectSearchSection(page, 'МКБ, симптомы и состояния');
  await expect(page.locator('.unified-catalog select')).toHaveCount(0);
  await expect(page.locator('.unified-catalog .document-library-card').first()).toBeVisible();
  await nav.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user/u);
  await nav.getByRole('button', { name: /^Настройки/u }).click();
  const legacy = page.getByRole('switch', { name: 'Разбивать навигацию на разделы' });
  await legacy.click();
  await expect(nav.locator('.app-nav-button')).toHaveCount(6);
  await expect(nav.getByRole('button', { name: /^База знаний/u })).toBeVisible();
  await legacy.click();
  await expect(nav.locator('.app-nav-button')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('unified-navigation-phone.png') });
});
