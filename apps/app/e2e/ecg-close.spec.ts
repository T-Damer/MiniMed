import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

test('closing the ECG editor returns to where the user came from, not to a tool page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  // The editor opens from a place the user was at: closing it is one history step back to that place.
  await page.evaluate(() => {
    window.location.hash = '#/notes';
  });
  await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '#/calculators/ecg-photo-caliper';
  });
  const editor = page.getByRole('dialog', { name: 'Загрузите ЭКГ' });
  await expect(editor).toBeVisible();

  await editor.getByRole('button', { name: 'Закрыть' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL(/#\/notes$/u);
  await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible();

  // The tool opens again from its entry points.
  await page.evaluate(() => {
    window.location.hash = '#/calculators/ecg-photo-caliper';
  });
  await expect(page.getByRole('dialog', { name: 'Загрузите ЭКГ' })).toBeVisible();
});

test('a deep link to the ECG tool closes to the search page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
  await page.goto(`${E2E_ASSET_ORIGIN}/#/calculators/ecg-photo-caliper`);
  const editor = page.getByRole('dialog', { name: 'Загрузите ЭКГ' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page).toHaveURL(/#\/search$/u);
});
