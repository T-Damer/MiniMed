import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

async function openLibrary(page: Page): Promise<void> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
}

test('EPUB chapters remain at their target after navigation and later scrolling', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openLibrary(page);
  await page
    .locator('.user-library-page__file-input')
    .setInputFiles(resolve('examples/pg11-images-3.epub'));
  const bookCard = page.locator('.user-library-card').filter({ hasText: 'pg11-images-3' });
  await expect(bookCard).toHaveAttribute('draggable', 'true');
  await bookCard.click();
  const chapter = page.getByRole('button', { name: 'CHAPTER VII. A Mad Tea-Party', exact: true });
  await chapter.waitFor();
  await chapter.click();
  const targetTop = () =>
    page.evaluate(() => {
      for (const frame of document.querySelectorAll<HTMLIFrameElement>(
        '.rich-document-renderer iframe',
      )) {
        const heading = frame.contentDocument?.getElementById('chap07');
        if (heading) return frame.getBoundingClientRect().top + heading.getBoundingClientRect().top;
      }
      return null;
    });
  await expect.poll(targetTop).not.toBeNull();
  await expect.poll(targetTop).toBeLessThan(250);
  await expect.poll(targetTop).toBeGreaterThanOrEqual(0);
  // The old alignTarget loop kept fighting the user's scroll for three seconds.
  await page.mouse.move(850, 400);
  await page.mouse.wheel(0, 350);
  await expect.poll(targetTop).toBeLessThan(0);
  await page.waitForTimeout(3500);
  expect(await targetTop()).toBeLessThan(0);
  await chapter.click();
  await page.evaluate(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      '.rich-document-renderer iframe',
    )) {
      const paragraph = frame.contentDocument
        ?.getElementById('chap07')
        ?.closest('.chapter')
        ?.querySelector('p');
      const node =
        paragraph &&
        frame.contentDocument?.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
      if (!node) continue;
      const range = frame.contentDocument?.createRange();
      if (!range) continue;
      range.setStart(node, 1);
      range.setEnd(node, 20);
      frame.contentWindow?.getSelection()?.removeAllRanges();
      frame.contentWindow?.getSelection()?.addRange(range);
      return;
    }
    throw new Error('Missing chapter text');
  });
  await expect(page.locator('.user-highlight-popup__color')).toHaveCount(5);
  await page.getByRole('button', { name: 'Выделить: красный' }).click();
  const mark = page.locator('.epub-user-highlight').first();
  await expect(mark).toHaveAttribute('fill', '#ef5350');
  await page.getByRole('link', { name: 'Ваши документы', exact: true }).click();
  await bookCard.click();
  await chapter.click();
  await expect(mark).toHaveAttribute('fill', '#ef5350');
  const rect = await mark.boundingBox();
  if (!rect) throw new Error('Missing EPUB annotation');
  await page.mouse.click(rect.x + 4, rect.y + rect.height / 2);
  await page.getByRole('button', { name: 'Убрать выделение' }).click();
  await expect(page.locator('.epub-user-highlight')).toHaveCount(0);
});

test('text highlights offer five colors, persist, and can be removed by tapping the mark', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: 'reader-highlight-check.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Проверка выделения текста. Сохранённая заметка доступна после открытия.'),
  });
  const textCard = page.locator('.user-library-card').filter({ hasText: 'reader-highlight-check' });
  await expect(textCard).toHaveAttribute('draggable', 'true');
  await textCard.click();
  const text = page.locator('.user-document-reader__text-section').first();
  await text.waitFor();
  await text.evaluate((section) => {
    const node = document.createTreeWalker(section, NodeFilter.SHOW_TEXT).nextNode();
    if (!node) throw new Error('Missing text');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 8);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  });
  await expect(page.locator('.user-highlight-popup__color')).toHaveCount(5);
  const palette = await page.locator('.user-highlight-popup').boundingBox();
  expect(palette && palette.x >= 0 && palette.x + palette.width <= 390).toBe(true);
  await page.getByRole('button', { name: 'Выделить: синий' }).click();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('user-doc-highlights-blue')?.size))
    .toBe(1);
  await page.getByRole('link', { name: 'Ваши документы', exact: true }).click();
  await page.locator('.user-library-card').filter({ hasText: 'reader-highlight-check' }).click();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('user-doc-highlights-blue')?.size), {
      timeout: 30000,
    })
    .toBe(1);
  const point = await text.evaluate((section) => {
    const range = [...(CSS.highlights.get('user-doc-highlights-blue') ?? [])][0] as
      | Range
      | undefined;
    if (!range) throw new Error('Missing saved highlight');
    const rect = range.getClientRects()[0];
    if (!rect) throw new Error('Missing painted highlight');
    const container = section.getBoundingClientRect();
    return { x: rect.left - container.left + 4, y: rect.top - container.top + rect.height / 2 };
  });
  await text.click({ position: point });
  await page.getByRole('button', { name: 'Убрать выделение' }).click({ timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('user-doc-highlights-blue')?.size))
    .toBe(0);
  await page.getByRole('link', { name: 'Ваши документы', exact: true }).click();
  await textCard.click();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('user-doc-highlights-blue')?.size))
    .toBe(0);
});
