import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

test('an ICD-10-coded card names its ICD-11 codes from WHO tables', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toHaveAttribute('data-search-ready', 'true', { timeout: 90_000 });
  await input.fill('Эпилепсия и эпилептический статус');
  await page.getByTestId('search-submit').click();
  const card = page
    .locator('.result-group')
    .filter({ hasText: 'Эпилепсия и эпилептический статус у взрослых и детей' })
    .first();
  await card.locator('.result-group-header').click();
  const panel = page.getByTestId('icd10-to-icd11-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  // The recommendation carries many ICD-10 codes: one folded row names how many have an answer.
  await expect(panel).toContainText(/В МКБ-11: соответствия для \d+ код/u);
  await panel.getByRole('button', { name: /В МКБ-11/u }).click();
  await expect(panel).toContainText('G40.9');
  await expect(panel).toContainText('Глава МКБ-11');
  await expect(panel).toContainText('Таблицы ВОЗ');
});
