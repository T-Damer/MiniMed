import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const pointerId =
  'core.catalog.pointer.medication.esklp.mnn.аскорбиновая-кислота-парацетамол-bfbe39d48f8ac5dc';

test('a medication lookup preserves the reader position and shows source strengths', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const token = Buffer.from(pointerId).toString('base64url');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/${token}`);
  const link = page
    .locator('.document-text-chunk .document-inline-link')
    .filter({ hasText: /^АСКОРБИНОВАЯ КИСЛОТА$/u })
    .first();
  await link.waitFor();
  await link.scrollIntoViewIfNeeded();
  const url = page.url();
  await link.click();
  const preview = page.locator('.document-inline-preview__card');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/форма|концентрация/iu);
  await expect(preview).toContainText(/мг|%/u);
  await expect(preview).toContainText('не схема дозирования');
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(link).toBeInViewport();
});

test('search source context uses the same inline medication lookup', async ({ page }) => {
  test.setTimeout(90_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.getByTestId('search-input').fill('АСКОРБИНОВАЯ КИСЛОТА ПАРАЦЕТАМОЛ');
  const result = page
    .locator('.result-group')
    .filter({ has: page.getByText('АСКОРБИНОВАЯ КИСЛОТА+ПАРАЦЕТАМОЛ', { exact: true }) })
    .getByTestId('search-result')
    .filter({ hasText: /Стандартизированное МНН/u })
    .first();
  await result.waitFor({ timeout: 30_000 });
  await result.click();
  const link = page
    .locator('.source-paragraph .document-inline-link')
    .filter({ hasText: /^АСКОРБИНОВАЯ КИСЛОТА$/u })
    .first();
  await link.click();
  await expect(page.locator('.document-inline-preview__card')).toContainText(/мг|%/u);
  await expect(page.locator('.source-paragraph')).toHaveCount(1);
});
