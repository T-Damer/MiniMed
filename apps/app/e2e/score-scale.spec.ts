import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

async function openCardiologyCalculator(
  page: import('@playwright/test').Page,
  slug: string,
): Promise<void> {
  await mountBuiltApp(page, { persistentOrigin: true });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Скачать раздел — Кардиология' }).click();
  // Every tool of the section is offline: «N из N», whatever N the section has grown to.
  await expect(page.getByText(/^Доступно офлайн: (\d+) из \1$/u)).toBeVisible();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/calculators/${slug}`);
}

test('draws a banded score scale for a class result and keeps the licence out of the body', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openCardiologyCalculator(page, 'nyha-functional-class');

  await page.locator('select').first().selectOption('3');
  await page.getByTestId('calculator-submit').click();

  const scale = page.getByTestId('score-scale');
  await expect(scale).toBeVisible();
  // Four equal class segments, the third one active, the text of that class below the track.
  await expect(scale.locator('.score-scale__segment')).toHaveCount(4);
  await expect(scale.locator('.score-scale__segment--active')).toHaveCount(1);
  await expect(scale.locator('.score-scale__segment-label--active')).toHaveText('Класс III');
  await expect(scale.locator('.score-scale__text')).toContainText('Класс III');
  // The result card is brought into view after calculating.
  await expect(page.getByTestId('calculator-result')).toBeInViewport();

  // Sources are small text at the bottom and an «Информация» item in the menu.
  await expect(page.locator('.calculator-footnote')).toContainText('Источники:');
  // The «Расчёт сохранён» toast sits under the route header over the menu; let it go first.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.getByTestId('calculator-menu').click();
  await page.getByRole('menuitem', { name: 'Информация' }).click();
  await expect(page.getByRole('dialog', { name: 'Информация' })).toBeVisible();
});

test('slides the marker onto the value of a proportional scale', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openCardiologyCalculator(page, 'wells-pe-probability');

  await page.locator('#calculator-input-dvtSigns').selectOption('1');
  await page.locator('#calculator-input-peMostLikely').selectOption('1');
  await page.locator('#calculator-input-heartRate').fill('110');
  await page.getByTestId('calculator-submit').click();

  const scale = page.getByTestId('score-scale');
  await expect(scale).toContainText('7,5');
  const marker = scale.locator('.score-scale__marker');
  const active = scale.locator('.score-scale__segment--active');
  await expect
    .poll(async () => {
      const markerBox = await marker.boundingBox();
      const activeBox = await active.boundingBox();
      if (!markerBox || !activeBox) return false;
      const centre = markerBox.x + markerBox.width / 2;
      return centre >= activeBox.x && centre <= activeBox.x + activeBox.width;
    })
    .toBe(true);
});
