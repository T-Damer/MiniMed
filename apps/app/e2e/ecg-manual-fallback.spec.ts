import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const origin =
  process.env.ECG_MANUAL_QA_ORIGIN ?? process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173';
const fixture = resolve(
  process.env.ECG_MANUAL_QA_FILE ?? 'apps/app/src/assets/ecg-photo-example.jpg',
);

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.ecg-editor__canvas').evaluate(
    (element, p) => {
      const svg = element as SVGSVGElement;
      const image = svg.querySelector('image');
      const matrix = svg.getScreenCTM();
      if (!image || !matrix) throw new Error('ECG canvas is not ready.');
      const result = new DOMPoint(
        p.x * image.width.baseVal.value,
        p.y * image.height.baseVal.value,
      ).matrixTransform(matrix);
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}

async function draw(page: Page, start: readonly [number, number], end: readonly [number, number]) {
  const from = await screenPoint(page, ...start);
  const to = await screenPoint(page, ...end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function addPoint(page: Page, group: string, label: string, x: number, y: number) {
  await page.getByLabel(`Добавить ${group}`, { exact: true }).click();
  if (group !== 'R') await page.getByRole('button', { name: label, exact: true }).click();
  const selected = page.locator('.ecg-editor__point-hit[aria-pressed="true"]');
  const from = await selected.boundingBox();
  if (!from) throw new Error('Point was not added.');
  const to = await screenPoint(page, x, y);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('reviews a photo in five fullscreen steps, undoes edits and prints one report', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  // UI/coordinate regression only: the deliberately placed test markers are not clinical annotations.
  await context.addInitScript(() => {
    window.print = () => {};
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${origin}/#/calculators/ecg-photo-caliper`);
  await expect(page.getByRole('heading', { name: 'Загрузите ЭКГ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Следующий шаг' })).toBeDisabled();
  await page.getByLabel('Загрузить ЭКГ', { exact: true }).setInputFiles(fixture);
  const canvas = page.locator('.ecg-editor__canvas');
  const fullView = await canvas.getAttribute('viewBox');
  for (let i = 0; i < 8; i++)
    await page.getByRole('button', { name: 'Увеличить ЭКГ', exact: true }).click();
  const zoomed = (await canvas.getAttribute('viewBox'))?.split(' ').map(Number);
  expect(zoomed?.[2]).toBeCloseTo(Number(fullView?.split(' ')[2]) / 20);
  await page.getByRole('button', { name: 'Показать всю ЭКГ' }).click();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas missing');
  const touch = await context.newCDPSession(page);
  const y = bounds.y + bounds.height / 2;
  const x = bounds.x + bounds.width / 2;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 70, y, id: 1 },
      { x: x + 70, y, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(canvas).not.toHaveAttribute('viewBox', fullView ?? '');
  await page.getByRole('button', { name: 'Показать всю ЭКГ' }).click();
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await page.getByRole('combobox', { name: 'Возраст', exact: true }).selectOption('adult');
  await page.getByRole('combobox', { name: 'Пол для QTc', exact: true }).selectOption('male');
  await page.screenshot({ path: 'output/playwright/ecg-editor-SE-calibration.png' });
  await page.getByRole('button', { name: 'Отметить 25 мм ↔' }).click();
  await draw(page, [0.1, 0.1], [0.35, 0.1]);
  await page.getByRole('button', { name: 'Отметить 10 мм ↕' }).click();
  await draw(page, [0.4, 0.1], [0.4, 0.2]);
  await page.getByLabel('Скорость, усиление и обе шкалы проверены').check();
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(page.locator('.ecg-editor__region')).toHaveCount(13);
  const rhythm = page.getByRole('button', { name: 'Область II · ритм', exact: true });
  const before = await rhythm.getAttribute('x');
  await draw(page, [0.5, 0.85], [0.52, 0.85]);
  await expect(rhythm).not.toHaveAttribute('x', before ?? '');
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await expect(rhythm).toHaveAttribute('x', before ?? '');
  await page.getByLabel('Области всех отведений проверены').check();
  await page.getByRole('button', { name: 'Следующий шаг' }).click();

  await addPoint(page, 'Q', 'Начало QRS', 0.29, 0.82);
  await addPoint(page, 'S', 'Конец QRS', 0.315, 0.82);
  await addPoint(page, 'R', '', 0.3, 0.78);
  await addPoint(page, 'R', '', 0.55, 0.78);
  await addPoint(page, 'P', 'Начало P', 0.25, 0.82);
  await addPoint(page, 'P', 'Конец P', 0.275, 0.82);
  await addPoint(page, 'T', 'Конец T', 0.4, 0.82);
  await expect(page.locator('.ecg-editor__point-hit')).toHaveCount(7);
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await page.getByRole('button', { name: 'Повторить изменение', exact: true }).click();
  await page.getByLabel('Точки в отведении для расчёта проверены по ЭКГ').check();
  await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click();
  await expect(page.getByLabel('Точки в отведении для расчёта проверены по ЭКГ')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Следующий шаг' })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить изменение', exact: true }).click();
  await page.getByLabel('Точки в отведении для расчёта проверены по ЭКГ').check();
  await page.screenshot({ path: 'output/playwright/ecg-editor-points-desktop.png' });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.screenshot({ path: 'output/playwright/ecg-editor-points-mobile.png' });
  const geometry = await page.locator('.ecg-editor').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }));
  expect(geometry.width).toBe(geometry.viewportWidth);
  expect(geometry.height).toBe(geometry.viewportHeight);
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(
    page.locator('.ecg-report__metric').filter({ hasText: /^RR/ }).locator('dd'),
  ).toContainText('1000');
  await expect(
    page
      .locator('.ecg-report__metric')
      .filter({ has: page.locator('dt', { hasText: /^QT$/ }) })
      .locator('dd'),
  ).toContainText('440');
  await page.screenshot({ path: 'output/playwright/ecg-editor-report-mobile.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect
    .poll(async () =>
      page.locator('.ecg-report').evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(568);
  await page.screenshot({ path: 'output/playwright/ecg-editor-report-SE-small.png' });
  await page.setViewportSize({ width: 375, height: 667 });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Распечатать', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('.ecg-report__image')).toBeVisible();
  await popup.evaluate(() => {
    window.onafterprint = null;
  });
  await popup.pdf({ path: 'output/playwright/ecg-editor-report.pdf', preferCSSPageSize: true });
  await popup.close();
  await page.getByRole('button', { name: 'Предыдущий шаг' }).click();
  await expect(page.locator('.ecg-editor__point-hit')).toHaveCount(7);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Предыдущий шаг' }).click();
  await page.getByLabel('Загрузить ЭКГ', { exact: true }).setInputFiles(fixture);
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(page.getByRole('button', { name: 'Следующий шаг' })).toBeDisabled();
});
