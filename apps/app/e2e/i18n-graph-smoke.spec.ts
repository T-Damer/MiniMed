import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

function navigationButton(page: import('@playwright/test').Page, name: string) {
  return page.locator('.app-nav-icons').getByRole('button', { name, exact: true });
}

test('shows localized specialty labels in the document library', async ({ page }) => {
  await mountBuiltApp(page);
  await navigationButton(page, 'База знаний').click();
  await page.getByRole('tab', { name: 'На устройстве' }).click();
  await expect(page.getByText('Педиатрия').first()).toBeVisible();
  await expect(page.getByText('clinical-pharmacology')).toHaveCount(0);

  await page.getByRole('button', { name: /Карта связей/u }).click();
  await expect(page.getByRole('heading', { name: 'Области и документы' })).toBeVisible();
  await expect(page.getByText('медицинская область')).toBeVisible();
  await expect(page.getByText('clinical-pharmacology')).toHaveCount(0);
  await expect(page.getByText('pediatrics')).toHaveCount(0);
});
