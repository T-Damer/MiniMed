import { expect, type Page, test } from '@playwright/test';

const origin =
  process.env.ECG_MANUAL_QA_ORIGIN ?? process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173';

/** A non-patient ECG-grid sheet photographed at an angle: rotated and sheared on a dark table. */
async function skewedSheetPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#464a50';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // 1 mm = 5 px on a 180 × 120 mm sheet; skew and rotation stand in for a hand-held phone.
    context.setTransform(0.97, 0.12, -0.18, 0.95, 230, 90);
    context.fillStyle = '#faf7f2';
    context.fillRect(0, 0, 900, 600);
    for (let mm = 0; mm <= 180; mm += 1) {
      context.strokeStyle = mm % 5 === 0 ? '#c84646' : '#f0afaf';
      context.lineWidth = mm % 5 === 0 ? 1.4 : 0.6;
      context.beginPath();
      context.moveTo(mm * 5, 0);
      context.lineTo(mm * 5, 600);
      context.stroke();
    }
    for (let mm = 0; mm <= 120; mm += 1) {
      context.strokeStyle = mm % 5 === 0 ? '#c84646' : '#f0afaf';
      context.lineWidth = mm % 5 === 0 ? 1.4 : 0.6;
      context.beginPath();
      context.moveTo(0, mm * 5);
      context.lineTo(900, mm * 5);
      context.stroke();
    }
    context.strokeStyle = '#1b1b1b';
    context.lineWidth = 2;
    context.beginPath();
    for (let x = 0; x <= 900; x += 3) {
      const phase = x % 150;
      const y = 300 - (phase > 60 && phase < 70 ? 60 : 0) - Math.sin(x / 20) * 4;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

async function draw(page: Page, start: readonly [number, number], end: readonly [number, number]) {
  const [from, to] = await page.locator('.ecg-editor__canvas').evaluate(
    (element, points) => {
      const svg = element as SVGSVGElement;
      const image = svg.querySelector('image');
      const matrix = svg.getScreenCTM();
      if (!image || !matrix) throw new Error('ECG canvas is not ready.');
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
  if (!from || !to) throw new Error('Calibration positions missing');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('finds sheet corners, rectifies an angled photo and calibrates on the rectified image', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // First-run package setup and its feature tour overlay the tool route in a fresh profile.
  await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${origin}/#/calculators/ecg-photo-caliper`);
  await expect(page.getByRole('heading', { name: 'Загрузите ЭКГ' })).toBeVisible();
  const photo = await skewedSheetPng(page);
  await page
    .getByLabel('Загрузить ЭКГ', { exact: true })
    .setInputFiles({ name: 'angled-sheet.png', mimeType: 'image/png', buffer: photo });

  const panel = page.getByRole('region', { name: 'Перспектива снимка' });
  await expect(panel).toContainText('Углы листа найдены автоматически');
  await expect(page.locator('.ecg-editor__sheet-handle')).toHaveCount(4);
  const image = page.locator('.ecg-editor__photo');
  await expect(image).toHaveAttribute('width', '1200');
  await page.screenshot({ path: 'output/playwright/ecg-perspective-corners.png' });

  await panel.getByRole('button', { name: 'Выпрямить по углам' }).click();
  await expect(panel).toContainText('Снимок выпрямлен по 4 углам');
  await expect(page.locator('.ecg-editor__sheet-handle')).toHaveCount(0);
  await expect(image).not.toHaveAttribute('width', '1200');
  await page.screenshot({ path: 'output/playwright/ecg-perspective-rectified.png' });

  // Calibration now runs on the rectified sheet.
  await page.getByRole('button', { name: 'Фото подходит — далее' }).click();
  await page.getByRole('combobox', { name: 'Скорость', exact: true }).selectOption('25');
  await page.getByRole('button', { name: 'Отметить 25 мм ↔' }).click();
  await draw(page, [0.1, 0.2], [0.24, 0.2]);
  await page.getByRole('button', { name: 'Отметить 10 мм ↕' }).click();
  await draw(page, [0.3, 0.2], [0.3, 0.28]);
  await page.getByRole('button', { name: 'Калибровка верна — далее' }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте отведения' })).toBeVisible();

  // The original upload is kept and can be restored; that resets geometry-bound markup.
  await page.getByRole('button', { name: 'Снимок', exact: true }).click();
  await panel.getByRole('button', { name: 'Вернуть оригинал' }).click();
  await expect(image).toHaveAttribute('width', '1200');
  await expect(page.locator('.ecg-editor__sheet-handle')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Калибровка', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Фото подходит — далее' }).click();
  await expect(page.getByRole('button', { name: 'Калибровка верна — далее' })).toBeDisabled();
});
