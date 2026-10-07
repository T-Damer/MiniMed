import { expect, type Locator, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/** An 800×600 PNG, rendered in the page, so the spec carries no binary fixture. */
async function syntheticPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    const gradient = context.createLinearGradient(0, 0, 800, 600);
    gradient.addColorStop(0, '#d33');
    gradient.addColorStop(1, '#33d');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#fff';
    context.font = '48px sans-serif';
    context.fillText('zoom fixture', 40, 80);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  return Buffer.from(base64, 'base64');
}

async function openImageLightbox(page: Page): Promise<{ surface: Locator; image: Locator }> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: 'zoom-fixture.png',
    mimeType: 'image/png',
    buffer: await syntheticPng(page),
  });
  const card = page.locator('.user-library-card').filter({ hasText: 'zoom-fixture' });
  await card.first().waitFor();
  await card.first().click();
  await page.locator('.user-document-reader__image-open').click();
  const surface = page.locator('.user-doc-image-lightbox .pinch-zoom-surface--image');
  const image = surface.locator('img');
  await expect(image).toBeVisible();
  // The dialog scales in; measure the picture only once it stopped moving.
  let previous = '';
  await expect
    .poll(async () => {
      const current = JSON.stringify(await image.boundingBox());
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
  return { surface, image };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(locator: Locator): Promise<Box> {
  const result = await locator.boundingBox();
  if (!result) throw new Error('element has no box');
  return result;
}

/** Fraction of the picture (0..1 across, 0..1 down) drawn under a screen point. */
function pictureFraction(image: Box, x: number, y: number): { fx: number; fy: number } {
  return { fx: (x - image.x) / image.width, fy: (y - image.y) / image.height };
}

test('the wheel zooms the image preview around the cursor, not its centre', async ({ page }) => {
  test.setTimeout(120_000);
  const { surface, image } = await openImageLightbox(page);
  const before = await box(image);
  // A point in the upper-right part of the picture, far from its centre.
  const cursor = { x: before.x + before.width * 0.8, y: before.y + before.height * 0.25 };
  const start = pictureFraction(before, cursor.x, cursor.y);

  await page.mouse.move(cursor.x, cursor.y);
  for (let notch = 0; notch < 4; notch += 1) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(40);
  }
  await expect.poll(async () => (await box(image)).width).toBeGreaterThan(before.width * 1.4);

  const zoomed = await box(image);
  const now = pictureFraction(zoomed, cursor.x, cursor.y);
  expect(now.fx).toBeCloseTo(start.fx, 1);
  expect(now.fy).toBeCloseTo(start.fy, 1);
  // The preview's own box did not move or grow: the picture is clipped inside it.
  const frame = await box(surface);
  expect(frame.width).toBeCloseTo(before.width, 0);
  // Zoomed content always covers the surface (no empty margin to pan into).
  expect(zoomed.x).toBeLessThanOrEqual(frame.x + 0.5);
  expect(zoomed.y).toBeLessThanOrEqual(frame.y + 0.5);
  expect(zoomed.x + zoomed.width).toBeGreaterThanOrEqual(frame.x + frame.width - 0.5);
  expect(zoomed.y + zoomed.height).toBeGreaterThanOrEqual(frame.y + frame.height - 0.5);
});

test('a double click zooms to the clicked point and a second one zooms back out', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { image } = await openImageLightbox(page);
  const before = await box(image);
  const cursor = { x: before.x + before.width * 0.2, y: before.y + before.height * 0.7 };
  const start = pictureFraction(before, cursor.x, cursor.y);

  await page.mouse.dblclick(cursor.x, cursor.y);
  await expect.poll(async () => (await box(image)).width).toBeGreaterThan(before.width * 1.9);
  const zoomed = await box(image);
  const now = pictureFraction(zoomed, cursor.x, cursor.y);
  expect(now.fx).toBeCloseTo(start.fx, 1);
  expect(now.fy).toBeCloseTo(start.fy, 1);

  await page.mouse.dblclick(cursor.x, cursor.y);
  await expect.poll(async () => (await box(image)).width).toBeCloseTo(before.width, 0);
});

test('dragging pans a zoomed preview but never past the picture edge', async ({ page }) => {
  test.setTimeout(120_000);
  const { surface, image } = await openImageLightbox(page);
  const before = await box(image);
  const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.dblclick(centre.x, centre.y);
  await expect.poll(async () => (await box(image)).width).toBeGreaterThan(before.width * 1.9);
  const zoomed = await box(image);

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 40, { steps: 6 });
  await page.mouse.up();
  const panned = await box(image);
  expect(panned.x).toBeGreaterThan(zoomed.x + 20);
  expect(panned.y).toBeGreaterThan(zoomed.y + 10);

  // A huge drag stops at the edge: the picture still covers the whole surface.
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 2000, centre.y + 2000, { steps: 6 });
  await page.mouse.up();
  const frame = await box(surface);
  const edge = await box(image);
  expect(edge.x).toBeCloseTo(frame.x, 0);
  expect(edge.y).toBeCloseTo(frame.y, 0);
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true });

  test('a two-finger pinch zooms around the fingers, and a double tap zooms to the tap', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 800 });
    const { image } = await openImageLightbox(page);
    const before = await box(image);
    // Fingers well to the right of the picture's centre.
    const centre = { x: before.x + before.width * 0.75, y: before.y + before.height * 0.5 };
    const start = pictureFraction(before, centre.x, centre.y);
    const cdp = await page.context().newCDPSession(page);
    const finger = (id: number, x: number, y: number) => ({ id, x, y });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [finger(1, centre.x - 25, centre.y), finger(2, centre.x + 25, centre.y)],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          finger(1, centre.x - 25 - step * 5, centre.y),
          finger(2, centre.x + 25 + step * 5, centre.y),
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await box(image)).width).toBeGreaterThan(before.width * 1.5);
    const pinched = await box(image);
    const now = pictureFraction(pinched, centre.x, centre.y);
    expect(now.fx).toBeCloseTo(start.fx, 1);
    expect(now.fy).toBeCloseTo(start.fy, 1);

    // A double tap in the pinched state zooms back out to 1x.
    const tap = { x: before.x + before.width * 0.3, y: before.y + before.height * 0.4 };
    await page.touchscreen.tap(tap.x, tap.y);
    await page.touchscreen.tap(tap.x, tap.y);
    await expect.poll(async () => (await box(image)).width).toBeCloseTo(before.width, 0);
  });
});
