import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.ECG_SUCCESS_QA_FILE;
const origin =
  process.env.ECG_SUCCESS_QA_ORIGIN ?? process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:5175';
test.skip(
  !fixturePath,
  'Set ECG_SUCCESS_QA_FILE to a non-patient ECG fixture; downloads the published model.',
);

test('proposes local segmentation and editable unconfirmed points offline on iPhone SE', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  if (!fixturePath) throw new Error('ECG_SUCCESS_QA_FILE is required.');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${origin}/#/calculators/ecg-photo-caliper`);
  await page.getByRole('button', { name: 'Установить авторазметку · 19 МБ' }).click();
  await expect(page.getByRole('button', { name: /Отменить установку/ })).toHaveCount(0, {
    timeout: 120_000,
  });
  await expect(page.getByRole('button', { name: 'Установить авторазметку · 19 МБ' })).toHaveCount(
    0,
  );
  await page.getByLabel('Загрузить ЭКГ', { exact: true }).setInputFiles(resolve(fixturePath));
  await expect(page.locator('.ecg-editor__status').first()).toContainText(
    /Линии найдены|Автоматическое распознавание требует проверки/,
    { timeout: 90_000 },
  );
  await expect(page.locator('.ecg-editor__error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  // The fixture's faint grid may yield only one axis. Review supplies both axes;
  // these coordinates exercise the editor, not clinical measurement accuracy.
  await expect(page.locator('.ecg-editor__calibration-line').first()).toBeAttached();
  for (const [label, start, end] of [
    ['Отметить 25 мм ↔', [0.1, 0.1], [0.35, 0.1]],
    ['Отметить 10 мм ↕', [0.4, 0.1], [0.4, 0.2]],
  ] as const) {
    await page.getByRole('button', { name: label }).click();
    const positions = await page.locator('.ecg-editor__canvas').evaluate(
      (el, points) => {
        const svg = el as SVGSVGElement;
        const image = svg.querySelector('image');
        const matrix = svg.getScreenCTM();
        if (!image || !matrix) throw new Error('Canvas missing');
        return points.map(([x, y]) => {
          const p = new DOMPoint(
            x * image.width.baseVal.value,
            y * image.height.baseVal.value,
          ).matrixTransform(matrix);
          return { x: p.x, y: p.y };
        });
      },
      [start, end],
    );
    const [from, to] = positions;
    if (!from || !to) throw new Error('Calibration positions missing');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByLabel('Скорость, усиление и обе шкалы проверены').check();
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(page.locator('.ecg-editor__region')).toHaveCount(13);
  await page.getByLabel('Области всех отведений проверены').check();
  await page.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(page.locator('.ecg-editor__point-hit').first()).toBeAttached();
  await expect(page.getByLabel('Точки в отведении для расчёта проверены по ЭКГ')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Следующий шаг' })).toBeDisabled();
  await page.screenshot({ path: 'output/playwright/ecg-editor-auto-SE.png' });
  await context.setOffline(true);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Предыдущий шаг' }).click();
  await page.getByLabel('Загрузить ЭКГ', { exact: true }).setInputFiles(resolve(fixturePath));
  await expect(page.locator('.ecg-editor__status').first()).toContainText(
    /Линии найдены|Автоматическое распознавание требует проверки/,
    { timeout: 90_000 },
  );
  await expect(page.locator('.ecg-editor__error')).toHaveCount(0);
});
