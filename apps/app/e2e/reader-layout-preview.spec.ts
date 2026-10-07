import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');

async function mountClinicalReader(
  page: Page,
  viewport: { width: number; height: number },
  options: { splitNavigation?: boolean } = {},
): Promise<void> {
  await routeClinicalModule(page);
  await page.setViewportSize(viewport);
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    ...(options.splitNavigation === undefined ? {} : { splitNavigation: options.splitNavigation }),
  });
  await expect(page.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
    timeout: 60_000,
  });
  await installClinicalModule(page);
  await expect(page.locator('.document-overlay-section').first()).toBeVisible();
}

// D. Between a tablet's and a small laptop's width the reader has its desktop column layout while
// the floating bottom navigation is centred over the page and reaches over the contents column.
const COLUMN_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 800, height: 1000 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

for (const viewport of COLUMN_VIEWPORTS) {
  test(`the contents column ends above the bottom bar at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mountClinicalReader(page, viewport);
    const column = page.locator('.document-overlay-outline--open');
    await expect(column).toBeVisible();
    const footer = column.locator('.doctor-technical-details');
    await expect(footer).toBeVisible();

    const result = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('.app-bottom-nav');
      const footerElement = document.querySelector<HTMLElement>(
        '.document-overlay-outline--open .doctor-technical-details',
      );
      const nav = document.querySelector<HTMLElement>('.document-overlay-outline-nav-scroll');
      if (!bar || !footerElement || !nav) throw new Error('reader chrome is missing');
      const barBox = bar.getBoundingClientRect();
      const footerBox = footerElement.getBoundingClientRect();
      const listBox = nav.getBoundingClientRect();
      // Whatever is on top at the centre of the lowest content of the column must be the column.
      const centre = (box: DOMRect) => document.elementFromPoint(box.left + 24, box.bottom - 8);
      const horizontalOverlap = barBox.left < footerBox.right && barBox.right > footerBox.left;
      return {
        horizontalOverlap,
        footerBottom: Math.round(footerBox.bottom),
        listBottom: Math.round(listBox.bottom),
        barTop: Math.round(barBox.top),
        footerCovered: Boolean(centre(footerBox)?.closest('.app-bottom-nav')),
        listCovered: Boolean(centre(listBox)?.closest('.app-bottom-nav')),
      };
    });
    // The check means something only where the bar does reach over the column.
    if (viewport.width <= 800) expect(result.horizontalOverlap).toBe(true);
    expect(result.footerCovered).toBe(false);
    expect(result.listCovered).toBe(false);
    if (result.horizontalOverlap) {
      expect(result.footerBottom).toBeLessThanOrEqual(result.barTop);
      expect(result.listBottom).toBeLessThanOrEqual(result.barTop);
    }
    await page.screenshot({
      path: `${process.env['UX12_SHOTS'] ?? 'playwright/test-results'}/ux12-column-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  });
}

// E. The image preview fits the free area: never under its title bar, never past the edge.
const FIT_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
] as const;

for (const viewport of FIT_VIEWPORTS) {
  test(`the reader's image preview fits its panel at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mountClinicalReader(page, viewport);
    await page.waitForTimeout(2500);
    const control = page.locator('.document-rich-image__control').first();
    await control.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await expect(control).toBeVisible();
    await control.click();
    const image = page.locator('.media-viewer__image');
    await expect(image).toBeVisible();
    await expect
      .poll(async () => (await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)) > 0)
      .toBe(true);
    await page.waitForTimeout(500);

    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`${selector} is missing`);
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      const content = document.querySelector<HTMLElement>('.media-viewer__content');
      return {
        content: rect('.media-viewer__content'),
        toolbar: rect('.media-viewer__toolbar'),
        image: rect('.media-viewer__image'),
        panel: rect('.media-viewer__panel'),
        scrolls: content ? content.scrollHeight > content.clientHeight + 1 : false,
      };
    });
    // Inside the free area (the content box below the toolbar), whole, and inside the window.
    expect(boxes.image.top).toBeGreaterThanOrEqual(boxes.toolbar.bottom - 0.5);
    expect(boxes.image.bottom).toBeLessThanOrEqual(boxes.content.bottom + 0.5);
    expect(boxes.image.left).toBeGreaterThanOrEqual(boxes.content.left - 0.5);
    expect(boxes.image.right).toBeLessThanOrEqual(boxes.content.right + 0.5);
    expect(boxes.image.top).toBeGreaterThanOrEqual(0);
    expect(boxes.image.bottom).toBeLessThanOrEqual(viewport.height);
    expect(boxes.scrolls).toBe(false);
    await page.screenshot({
      path: `${process.env['UX12_SHOTS'] ?? 'playwright/test-results'}/ux12-mediaviewer-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  });
}

/** A PNG of the given size drawn in the page, so the spec carries no binary fixture. */
async function syntheticPng(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2d context unavailable');
      context.fillStyle = '#3366cc';
      context.fillRect(0, 0, w as number, h as number);
      context.fillStyle = '#fff';
      context.font = '48px sans-serif';
      context.fillText('top edge', 40, 60);
      context.fillText('bottom edge', 40, (h as number) - 30);
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

for (const viewport of FIT_VIEWPORTS) {
  for (const shape of ['tall', 'wide'] as const) {
    test(`the user image lightbox fits its body at ${String(viewport.width)}x${String(viewport.height)}, ${shape} picture`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
      await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
      await page.locator('.user-library-page__file-input').setInputFiles({
        name: 'fit-fixture.png',
        mimeType: 'image/png',
        buffer: await syntheticPng(
          page,
          shape === 'tall' ? 1200 : 3000,
          shape === 'tall' ? 2400 : 1000,
        ),
      });
      const card = page.locator('.user-library-card').filter({ hasText: 'fit-fixture' });
      await card.first().waitFor();
      await card.first().click();
      await page.locator('.user-document-reader__image-open').click();
      const image = page.locator('.user-doc-image-lightbox__image');
      await expect(image).toBeVisible();
      await page.waitForTimeout(800);

      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`${selector} is missing`);
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        return {
          header: rect('.user-doc-image-lightbox .overlay-dialog-header'),
          body: rect('.user-doc-image-lightbox__body'),
          image: rect('.user-doc-image-lightbox__image'),
        };
      });
      expect(boxes.image.top).toBeGreaterThanOrEqual(boxes.header.bottom - 0.5);
      expect(boxes.image.top).toBeGreaterThanOrEqual(boxes.body.top - 0.5);
      expect(boxes.image.bottom).toBeLessThanOrEqual(boxes.body.bottom + 0.5);
      expect(boxes.image.left).toBeGreaterThanOrEqual(boxes.body.left - 0.5);
      expect(boxes.image.right).toBeLessThanOrEqual(boxes.body.right + 0.5);
      expect(boxes.image.bottom).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({
        path: `${process.env['UX12_SHOTS'] ?? 'playwright/test-results'}/ux12-lightbox-${String(viewport.width)}x${String(viewport.height)}-${shape}.png`,
      });
    });
  }
}

// E. A reference illustration of a document opens in the same zoomable preview.
const REFERENCE_ASSET_DIRECTORIES = [
  resolve(ROOT, 'apps/app/public/content/reference-images/assets'),
  resolve(ROOT, '../../../apps/app/public/content/reference-images/assets'),
];

test('a reference illustration opens in the shared zoomable preview', async ({ page }) => {
  test.setTimeout(120_000);
  const assets = REFERENCE_ASSET_DIRECTORIES.find((directory) => existsSync(directory));
  test.skip(!assets, 'The local reference-image assets are not on this machine.');
  // The mirror the app downloads illustrations from is answered from the local copy.
  await page.route('**/datasets/content-2026-09-06/assets/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
    const file = resolve(assets ?? '', name);
    if (!existsSync(file)) {
      await route.abort();
      return;
    }
    await route.fulfill({ body: await readFile(file), contentType: 'image/jpeg' });
  });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const id =
    'core.catalog.pointer.reference.krasotaimedicina.disease.0007ef852d70ba32-82f435504305e1c9';
  await page.evaluate((documentId) => {
    window.location.hash = `#/modules/documents/d/${btoa(documentId)}`;
  }, id);
  const illustration = page.locator('.document-reference-image__image');
  await expect(illustration).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => illustration.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.locator('.document-reference-image__open').click();
  const preview = page.locator('.media-viewer__image');
  await expect(preview).toBeVisible();
  // Double click zooms (the shared image zoom), the close button leaves the preview.
  const before = await preview.boundingBox();
  if (!before) throw new Error('the preview has no box');
  await page.mouse.dblclick(before.x + before.width / 2, before.y + before.height / 2);
  await expect
    .poll(async () => (await preview.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width * 1.5);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(preview).toHaveCount(0);
});

// F. A long definition stays a short card; the rest opens inside it.
test('a long term definition is clamped to a few lines and expands inside the card', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountClinicalReader(page, { width: 390, height: 844 });
  await page.waitForTimeout(2500);
  const link = page.locator('.document-inline-link', { hasText: 'Парадоксальная эмболия' }).first();
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const card = page.locator('.document-inline-preview__card');
  await expect(card).toBeVisible();
  const definition = card.locator('.document-inline-preview__definition');
  await expect(definition).toBeVisible();
  const fullLength = await definition.evaluate((element) => element.textContent?.length ?? 0);
  expect(fullLength).toBeGreaterThan(400);

  const more = card.getByRole('button', { name: 'Показать полностью' });
  await expect(more).toBeVisible();
  const open = card.getByRole('button', { name: /Открыть/u });
  await expect(open).toBeVisible();
  const compact = await card.boundingBox();
  if (!compact) throw new Error('the card has no box');
  // Short like a drug card: a fraction of the screen, not 581 of 844 px.
  expect(compact.height).toBeLessThan(300);
  const clampedHeight = await definition.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const lineHeight = await definition.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).lineHeight),
  );
  expect(clampedHeight).toBeLessThanOrEqual(lineHeight * 4 + 2);
  // «Открыть» is above the text, in the top part of the card.
  const openBox = await open.boundingBox();
  expect(openBox?.y ?? 9999).toBeLessThan(compact.y + 120);
  await page.screenshot({
    path: `${process.env['UX12_SHOTS'] ?? 'playwright/test-results'}/ux12-term-card-clamped.png`,
  });

  await more.click();
  await expect(card.getByRole('button', { name: 'Свернуть' })).toBeVisible();
  const expandedHeight = await definition.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(expandedHeight).toBeGreaterThan(clampedHeight * 2);
  // Even with the card scrolled to its end, «Открыть» stays at the top.
  await card.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const cardBox = await card.boundingBox();
  const openAfter = await open.boundingBox();
  expect(openAfter?.y ?? 9999).toBeLessThan((cardBox?.y ?? 0) + 120);
  await page.screenshot({
    path: `${process.env['UX12_SHOTS'] ?? 'playwright/test-results'}/ux12-term-card-expanded.png`,
  });

  await card.getByRole('button', { name: 'Свернуть' }).click();
  await expect(more).toBeVisible();
});
