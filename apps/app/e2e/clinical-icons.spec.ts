import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { selectSearchSection } from './select-search-section';

test('neonatology and pediatrics have distinct catalog icons', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await selectSearchSection(page, 'Опросники');
  await page.getByTestId('search-input').fill('неонатология');
  const neonatal = page
    .locator('.unified-catalog__tool .clinical-tags__tag[title="Неонатология"]')
    .first();
  await expect(neonatal).toBeVisible();
  const carriage = await neonatal.locator('svg').innerHTML();
  await page.getByTestId('search-input').fill('педиатрия');
  const pediatric = page
    .locator('.unified-catalog__tool .clinical-tags__tag[title="Педиатрия"]')
    .first();
  await expect(pediatric).toBeVisible();
  expect(await pediatric.locator('svg').innerHTML()).not.toBe(carriage);
});
