import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const fixturePath = process.env.ECG_SUCCESS_QA_FILE;
const origin = process.env.ECG_SUCCESS_QA_ORIGIN ?? 'http://127.0.0.1:5174';

test.skip(!fixturePath, 'Set ECG_SUCCESS_QA_FILE to a supported non-patient ECG fixture.');

test('keeps automatic measurements as one reviewable draft before Solver', async ({
  context,
  page,
}) => {
  test.setTimeout(3 * 60_000);
  if (!fixturePath) throw new Error('ECG_SUCCESS_QA_FILE is required.');

  await page.goto(`${origin}/#/calculators/ecg-photo-caliper`);
  await expect(page.getByRole('heading', { name: 'Измерения по фото ЭКГ' })).toBeVisible();
  if (await page.getByText('Оцифровка не установлена', { exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Установить всё' }).click();
    await expect(page.getByText('Оцифровка готова', { exact: true })).toBeVisible({
      timeout: 120_000,
    });
  }

  await page.locator('.ecg-example__file-input').first().setInputFiles(resolve(fixturePath));
  const dialog = page.getByRole('dialog', { name: 'Оцифровка ЭКГ' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Оцифровка прошла проверку', { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await dialog.getByLabel(/На записи указано 50 мм\/с/u).check();
  await dialog.getByRole('button', { name: 'Принять черновик и проверить интервалы' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.ecg-caliper__manual-workflow')).toHaveAttribute('open', '');
  await expect(page.locator('#ecg-feature-RR_Mean_Global')).not.toHaveValue('');
  await expect(page.locator('#ecg-feature-QRS_Dur_Global')).not.toHaveValue('');
  await expect(page.getByText('Амплитуды зубцов · 24/24', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Я сверил\(а\) интервалы/u)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Оценить гипотезы' })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await context.setOffline(true);
  await page.locator('.ecg-example__file-input').first().setInputFiles(resolve(fixturePath));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Оцифровка прошла проверку', { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(dialog.locator('.ecg-digitization-dialog__failure')).toHaveCount(0);
});
