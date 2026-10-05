import { expect, type Locator, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticPdf } from './synthetic-pdf';

const PAGES = 40;
const FILE_NAME = 'guideline-fixture.pdf';

async function openPdf(page: Page, pages = PAGES): Promise<void> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  // When the search core becomes ready the knowledge-base screens re-render; open the reader after.
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: FILE_NAME,
    mimeType: 'application/pdf',
    buffer: syntheticPdf({ pages }),
  });
  const card = page.locator('.user-library-card').filter({ hasText: 'guideline-fixture' });
  await card.first().waitFor();
  // The card opens the reader only once the file is stored and its text was read.
  await expect(card.first()).toContainText('Текстовый слой найден');
  await card.first().click();
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(pages);
  await expect(page.locator('.pdf-viewer__canvas').first()).toBeVisible();
  // Text extraction for the library runs in the background and re-renders the header menu while
  // it reports progress; open menus only after it has finished.
  await expect(page.locator('.user-document-reader__banner')).toHaveCount(0, { timeout: 60_000 });
}

function pageInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Номер страницы' });
}

async function currentPage(page: Page): Promise<number> {
  return Number(await pageInput(page).inputValue());
}

/** Distance of a page's top from the top of the window, in px. */
async function pageTop(page: Page, pageNumber: number): Promise<number> {
  return page
    .locator(`[data-pdf-page="${String(pageNumber - 1)}"]`)
    .evaluate((element) => element.getBoundingClientRect().top);
}

async function highlightedRangeCount(page: Page, name: string): Promise<number> {
  return page.evaluate((highlightName) => {
    const registry = CSS.highlights as unknown as Map<string, { size: number }>;
    return registry.get(highlightName)?.size ?? 0;
  }, name);
}

test('a multi-page PDF opens in the shared viewer with lazily drawn pages', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPdf(page);
  // Only pages near the screen hold a bitmap.
  const drawn = await page.locator('.pdf-viewer__canvas').count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(10);
  await expect(page.locator('.pdf-viewer__dock')).toBeVisible();
  expect(await currentPage(page)).toBe(1);
  await expect(page.locator('.pdf-viewer__page-total')).toHaveText(`/ ${String(PAGES)}`);
});

test('text of a page can be selected and copied', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPdf(page);
  const line = page.locator('.pdf-viewer__text-run', { hasText: 'Marker 1 alpha-1-omega' }).first();
  await line.waitFor({ state: 'attached', timeout: 30_000 });
  await line.click({ clickCount: 3 });
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())))
    .toContain('Marker 1 alpha-1-omega');
});

test('find matches a phrase across lines, highlights it and steps through the pages', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPdf(page);

  await page.getByRole('button', { name: 'Поиск в документе' }).click();
  // "adults" ends one line and "was reviewed" starts the next: pages 7, 14, 21, 28, 35.
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).fill('adults was reviewed');
  await expect(page.locator('.document-find__count')).toHaveText('1/5');
  await expect.poll(() => currentPage(page)).toBe(7);
  await expect.poll(() => highlightedRangeCount(page, 'pdf-find-active')).toBeGreaterThan(0);
  // The match is on screen, inside the reading area.
  const top = await pageTop(page, 7);
  expect(top).toBeLessThan(800);

  await page.getByRole('button', { name: 'Следующее совпадение' }).click();
  await expect(page.locator('.document-find__count')).toHaveText('2/5');
  await expect.poll(() => currentPage(page)).toBe(14);
  await expect.poll(() => highlightedRangeCount(page, 'pdf-find-active')).toBeGreaterThan(0);

  // Previous from the first match wraps to the last page.
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).press('Shift+Enter');
  await expect(page.locator('.document-find__count')).toHaveText('1/5');
  await page.getByRole('button', { name: 'Предыдущее совпадение' }).click();
  await expect(page.locator('.document-find__count')).toHaveText('5/5');
  await expect.poll(() => currentPage(page)).toBe(35);

  // A word that is not there.
  await page.getByRole('searchbox', { name: 'Поиск в документе' }).fill('nonexistent-term');
  await expect(page.locator('.document-find__count')).toHaveText('0/0');
  await expect.poll(() => highlightedRangeCount(page, 'pdf-find-hit')).toBe(0);
});

test('go to page, page buttons and thumbnails move through the document', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPdf(page);

  await pageInput(page).fill('33');
  await pageInput(page).press('Enter');
  await expect.poll(() => currentPage(page)).toBe(33);
  // A jump the reader makes itself is not the user scrolling on: the controls stay.
  await page.waitForTimeout(300);
  await expect(page.locator('html.app-chrome-hidden')).toHaveCount(0);
  await expect(page.locator('.pdf-viewer__dock')).toHaveCSS('opacity', '1');
  expect(Math.abs((await pageTop(page, 33)) - 80)).toBeLessThan(160);

  await page.getByRole('button', { name: 'Предыдущая страница' }).click();
  await expect.poll(() => currentPage(page)).toBe(32);
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  await expect.poll(() => currentPage(page)).toBe(33);

  // The side panel of a wide window already shows a picture of each page; a tap goes to it.
  await expect(page.locator('.pdf-thumbnails__item')).toHaveCount(PAGES);
  const thumbnail = page.getByRole('button', { name: 'Страница 5', exact: true });
  await thumbnail.scrollIntoViewIfNeeded();
  await expect
    .poll(async () =>
      page
        .locator('[data-pdf-thumbnail="4"] canvas')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(10);
  await thumbnail.click();
  await expect.poll(() => currentPage(page)).toBe(5);
  await expect(page.locator('[data-pdf-thumbnail="4"]')).toHaveAttribute('aria-current', 'page');
});

test('on a phone the page strip opens from the menu and closes after a page is chosen', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPdf(page);
  await expect(page.locator('.pdf-thumbnails__item')).toHaveCount(0);
  // The header's panel button opens the page strip (the menu item does the same).
  await page.getByRole('button', { name: 'Открыть оглавление' }).click();
  await expect(page.locator('.document-overlay-outline-header')).toHaveText('Страницы');
  await expect(page.locator('.pdf-thumbnails__item')).toHaveCount(PAGES);
  await expect
    .poll(async () =>
      page
        .locator('[data-pdf-thumbnail="0"] canvas')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Страница 12', exact: true }).click();
  await expect.poll(() => currentPage(page)).toBe(12);
  await expect(page.locator('.pdf-thumbnails__item')).toHaveCount(0);
});

test('zoom buttons, fit page and Ctrl+wheel resize the pages', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPdf(page);
  const firstPage = page.locator('[data-pdf-page="0"]');
  const baseWidth = (await firstPage.boundingBox())?.width ?? 0;
  expect(baseWidth).toBeGreaterThan(300);

  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect(page.locator('.pdf-viewer__dock-value')).toHaveText('125%');
  await expect
    .poll(async () => (await firstPage.boundingBox())?.width ?? 0)
    .toBeGreaterThan(baseWidth * 1.2);

  // «Вся страница» fits a whole page into the window height (zoom below 100 %).
  await page.locator('.pdf-viewer__dock-value').click();
  await page.locator('.pdf-viewer__dock-value').click();
  await expect(page.locator('.pdf-viewer__dock-value')).not.toHaveText('125%');
  const fitted = await firstPage.boundingBox();
  expect(fitted?.height ?? 9999).toBeLessThanOrEqual(800);

  await page.locator('.pdf-viewer__dock-value').click();
  await expect(page.locator('.pdf-viewer__dock-value')).toHaveText('100%');

  const box = await firstPage.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect
    .poll(async () => await page.locator('.pdf-viewer__dock-value').innerText())
    .not.toBe('100%');
});

test('the reading position and zoom come back after a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPdf(page);
  await pageInput(page).fill('18');
  await pageInput(page).press('Enter');
  await expect.poll(() => currentPage(page)).toBe(18);
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect(page.locator('.pdf-viewer__dock-value')).toHaveText('125%');
  // The position is saved shortly after the last scroll.
  await page.waitForTimeout(1200);

  await page.reload();
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(PAGES, { timeout: 90_000 });
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).toBe(18);
  await expect(page.locator('.pdf-viewer__dock-value')).toHaveText('125%');
  expect(Math.abs(await pageTop(page, 18))).toBeLessThan(400);
});

test('print hands the original PDF to the system print path', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const frames: string[] = [];
    (window as unknown as { __printFrames: string[] }).__printFrames = frames;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLIFrameElement && node.src.startsWith('blob:')) {
            frames.push(node.src);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await openPdf(page);
  await page.getByRole('button', { name: 'Меню действий' }).click();
  await page.getByRole('menuitem', { name: 'Печать' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __printFrames: string[] }).__printFrames.length),
    )
    .toBe(1);
  const type = await page.evaluate(async () => {
    const frames = (window as unknown as { __printFrames: string[] }).__printFrames;
    const blob = await (await fetch(frames[0] ?? '')).blob();
    return { type: blob.type, bytes: blob.size };
  });
  expect(type.type).toBe('application/pdf');
  expect(type.bytes).toBeGreaterThan(1000);
});

test('the page dock follows the reader chrome: down hides it, up brings it back', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPdf(page);
  const dock = page.locator('.pdf-viewer__dock');
  await expect(dock).toHaveCSS('opacity', '1');
  await page.mouse.move(200, 400);
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('html.app-chrome-hidden')).toHaveCount(1);
  await expect(dock).toHaveCSS('opacity', '0');
  for (let step = 0; step < 3; step += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('html.app-chrome-hidden')).toHaveCount(0);
  await expect(dock).toHaveCSS('opacity', '1');
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true });

  test('a two-finger pinch zooms the pages and keeps the page in view', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 800 });
    await openPdf(page);
    await pageInput(page).fill('9');
    await pageInput(page).press('Enter');
    await expect.poll(() => currentPage(page)).toBe(9);
    const firstPage = page.locator('[data-pdf-page="8"]');
    const before = (await firstPage.boundingBox())?.width ?? 0;

    const cdp = await page.context().newCDPSession(page);
    const point = (id: number, x: number, y: number) => ({ id, x, y });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, 150, 400), point(2, 240, 400)],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point(1, 150 - step * 10, 400), point(2, 240 + step * 10, 400)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect
      .poll(async () => (await firstPage.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before * 1.5);
    await expect(page.locator('.pdf-viewer__dock-value')).not.toHaveText('100%');
    // Zooming keeps the reader on the same page.
    await expect.poll(() => currentPage(page)).toBe(9);
  });
});
