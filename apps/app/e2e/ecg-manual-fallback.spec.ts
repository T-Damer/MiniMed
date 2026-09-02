import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const fixturePath = process.env.ECG_MANUAL_QA_FILE;
const origin = process.env.ECG_MANUAL_QA_ORIGIN ?? 'http://127.0.0.1:5174';

test.skip(!fixturePath, 'Set ECG_MANUAL_QA_FILE to a non-patient ECG photo fixture.');

test('guides a rejected photo through manual measurement without losing work', async ({
  context,
  page,
}) => {
  test.setTimeout(3 * 60_000);
  if (!fixturePath) throw new Error('ECG_MANUAL_QA_FILE is required.');

  await page.setViewportSize({ width: 1280, height: 900 });
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
  await expect(
    dialog
      .getByText('Оцифровку нужно проверить вручную', { exact: true })
      .or(dialog.getByText('Оцифровка отклонена', { exact: true })),
  ).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Перейти к ручной разметке' }).click();

  const workflow = page.locator('.ecg-caliper__manual-workflow');
  await expect(workflow).toHaveAttribute('open', '');
  await expect(workflow.getByText(/Автоматическ.*провер/u)).toBeVisible();

  const surface = workflow.locator('.ecg-caliper__zoom-surface');
  const drawRange = async (startRatio: number, endRatio: number): Promise<void> => {
    await surface.scrollIntoViewIfNeeded();
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error('Manual ECG surface is not visible.');
    const y = bounds.y + Math.min(bounds.height - 10, Math.max(10, bounds.height / 2));
    await page.mouse.move(bounds.x + bounds.width * startRatio, y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * endRatio, y, { steps: 8 });
    await page.mouse.up();
  };

  await drawRange(0.08, 0.28);
  await expect(workflow.getByRole('button', { name: /Калибровка сетки 25 мм ✓/u })).toBeVisible();
  await workflow.getByRole('button', { name: /^2\. RR/u }).click();
  await drawRange(0.34, 0.44);
  await expect(workflow.getByRole('button', { name: /RR ✓/u })).toBeVisible();

  const results = workflow.locator('.ecg-caliper__results');
  const beforeToggle = await results.innerText();
  expect(beforeToggle).toContain('RR');
  expect(beforeToggle).toContain('ЧСС');

  await workflow.getByRole('button', { name: 'Показать исходный снимок' }).click();
  await expect(workflow.getByAltText('Исходная ЭКГ для ручных измерений')).toBeVisible();
  await expect.poll(() => results.innerText()).toBe(beforeToggle);
  await expect(workflow.getByRole('button', { name: /Калибровка сетки 25 мм ✓/u })).toBeVisible();
  await expect(workflow.getByRole('button', { name: /RR ✓/u })).toBeVisible();

  await workflow.getByRole('button', { name: 'Показать выправленный лист' }).click();
  await expect(workflow.getByAltText('Выправленная ЭКГ для ручных измерений')).toBeVisible();
  await expect.poll(() => results.innerText()).toBe(beforeToggle);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workflow.getByText(/Границы и весь диапазон можно перетаскивать/u)).toBeVisible();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await context.setOffline(true);
  await page.locator('.ecg-example__file-input').first().setInputFiles(resolve(fixturePath));
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .getByText('Оцифровку нужно проверить вручную', { exact: true })
      .or(dialog.getByText('Оцифровка отклонена', { exact: true })),
  ).toBeVisible({ timeout: 90_000 });
  await expect(dialog.locator('.ecg-digitization-dialog__failure')).toHaveCount(0);
});
