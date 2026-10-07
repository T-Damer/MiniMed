import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticEpub } from './synthetic-epub';
import { syntheticPdf } from './synthetic-pdf';

const BOOK_TITLE = 'Проверочная книга';
const BOOK_AUTHOR = 'А. А. Автор';
/** A book that paints its own white page, as most do. */
const WHITE_PAGE_CSS = 'html, body { background: #fff; color: #000; } p { color: #111; }';

async function openLibrary(page: Page): Promise<void> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
}

async function addEpub(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('.user-library-page__file-input').setInputFiles({
    name,
    mimeType: 'application/epub+zip',
    buffer,
  });
}

test.describe('phone, dark theme', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });

  test('a book is named by its own title; the file stays visible and the reader follows the dark theme', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openLibrary(page);
    await addEpub(
      page,
      'synthetic-book.epub',
      await syntheticEpub({ title: BOOK_TITLE, author: BOOK_AUTHOR, css: WHITE_PAGE_CSS }),
    );
    // The card first carries the file name; once the book is read it carries its own title.
    const card = page.locator('.user-library-card').filter({ hasText: BOOK_TITLE });
    await expect(card).toBeVisible();
    await expect(card.locator('.user-library-card__file-name')).toHaveText(BOOK_TITLE);
    await expect(card.locator('.user-library-card__meta')).toContainText('EPUB');
    await page.screenshot({ path: testInfo.outputPath('library-390-dark.png') });

    await card.click();
    const heading = page.locator('.document-overlay-paper__title');
    await expect(heading).toHaveText(BOOK_TITLE);
    await expect(page.locator('.user-document-reader__file-meta')).toHaveText(
      `${BOOK_AUTHOR} · synthetic-book.epub`,
    );
    // The header does not repeat the heading: only the section the reader came from is left.
    await expect(page.locator('.document-crumbs')).toContainText('Ваши документы');
    await expect(page.locator('.document-crumbs')).not.toContainText(BOOK_TITLE);

    // The book's own white page and black text are replaced by the app theme.
    const frame = page.locator('.rich-document-renderer--epub iframe').first();
    await frame.waitFor();
    await expect
      .poll(async () =>
        frame.evaluate((element) => {
          const body = (element as HTMLIFrameElement).contentDocument?.body;
          if (!body) return null;
          const style = getComputedStyle(body);
          return { background: style.backgroundColor, color: style.color };
        }),
      )
      .toMatchObject({ background: expect.stringMatching(/^rgb\((\d+), (\d+), (\d+)\)$/u) });
    const colors = await frame.evaluate((element) => {
      const body = (element as HTMLIFrameElement).contentDocument?.body;
      const paragraph = body?.querySelector('p');
      if (!body || !paragraph) return null;
      return {
        background: getComputedStyle(body).backgroundColor,
        text: getComputedStyle(paragraph).color,
      };
    });
    const channels = (value: string | undefined): number[] =>
      (value?.match(/\d+/gu) ?? []).slice(0, 3).map(Number);
    const luminance = (rgb: number[]): number =>
      ((rgb[0] ?? 0) * 299 + (rgb[1] ?? 0) * 587 + (rgb[2] ?? 0) * 114) / 1000;
    expect(luminance(channels(colors?.background))).toBeLessThan(90);
    expect(luminance(channels(colors?.text))).toBeGreaterThan(160);
    await page.screenshot({ path: testInfo.outputPath('epub-reader-390-dark.png') });
  });

  test('two files with one base name are told apart by their format; the status wraps, not clips', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openLibrary(page);
    await addEpub(page, 'big-book.epub', await syntheticEpub());
    await page.locator('.user-library-page__file-input').setInputFiles({
      name: 'big-book.pdf',
      mimeType: 'application/pdf',
      buffer: syntheticPdf({ pages: 3 }),
    });
    const cards = page.locator('.user-library-card').filter({ hasText: 'big-book' });
    await expect(cards).toHaveCount(2);
    const metas = cards.locator('.user-library-card__meta');
    await expect(metas.filter({ hasText: 'Текстовый слой найден' })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(metas.filter({ hasText: /EPUB · / })).toHaveCount(1);
    await expect(metas.filter({ hasText: /PDF · / })).toHaveCount(1);
    // Nothing is cut: the whole status fits the card's two lines.
    for (const meta of await metas.all()) {
      const fits = await meta.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      );
      expect(fits).toBe(true);
    }
  });

  test('Escape closes the outline drawer and the bottom navigation does not cover it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openLibrary(page);
    await addEpub(page, 'synthetic-book.epub', await syntheticEpub());
    const card = page.locator('.user-library-card').filter({ hasText: 'synthetic-book' });
    await expect(card).toHaveAttribute('draggable', 'true');
    await card.click();
    const outline = page.locator('.document-overlay-outline');
    const nav = page.locator('.app-bottom-nav');
    const toggle = page.getByRole('button', { name: 'Открыть оглавление' });
    await expect(toggle).toBeEnabled();
    await expect(nav).toBeVisible();

    await toggle.click();
    await expect(outline).toHaveClass(/document-overlay-outline--open/u);
    // The navigation steps out of the drawer's way instead of sitting on its last items.
    await expect
      .poll(async () => {
        const box = await nav.boundingBox();
        return box ? box.y >= 844 : true;
      })
      .toBe(true);
    await expect(page.locator('html')).toHaveClass(/reader-outline-open/u);

    await page.keyboard.press('Escape');
    await expect(outline).toHaveClass(/document-overlay-outline--hidden/u);
    await expect(page.locator('html')).not.toHaveClass(/reader-outline-open/u);
    await expect
      .poll(async () => {
        const box = await nav.boundingBox();
        return box ? box.y + box.height <= 844 : false;
      })
      .toBe(true);
  });

  test('a file that cannot be read is marked failed and offers «Повторить»', async ({ page }) => {
    test.setTimeout(120_000);
    await openLibrary(page);
    await page.locator('.user-library-page__file-input').setInputFiles({
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      // The header passes validation; the body is not a PDF, so reading it fails.
      buffer: Buffer.from('%PDF-1.4\nthis is not a pdf at all\n'),
    });
    const card = page.locator('.user-library-card').filter({ hasText: 'broken' });
    const meta = card.locator('.user-library-card__meta');
    await expect(meta).not.toHaveText('Читаем файл…', { timeout: 30_000 });
    await expect(meta).not.toContainText('Текстовый слой');
    const failure = (await meta.innerText()).trim();
    expect(failure).not.toBe('');
    await card.click({ button: 'right' });
    const retry = page.getByRole('menuitem', { name: 'Повторить' });
    await expect(retry).toBeVisible();
    await retry.click();
    // The retry reads the file again and, the file being broken, ends the same way.
    await expect(meta).not.toHaveText('Читаем файл…', { timeout: 30_000 });
    expect((await meta.innerText()).trim()).toBe(failure);
  });
});

test.describe('light theme', () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

  test('the EPUB page keeps the light app colours and the title comes from the book', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openLibrary(page);
    await addEpub(
      page,
      'synthetic-book.epub',
      await syntheticEpub({ title: BOOK_TITLE, css: WHITE_PAGE_CSS }),
    );
    const card = page.locator('.user-library-card').filter({ hasText: BOOK_TITLE });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('.document-overlay-paper__title')).toHaveText(BOOK_TITLE);
    const frame = page.locator('.rich-document-renderer--epub iframe').first();
    await frame.waitFor();
    await expect
      .poll(async () =>
        frame.evaluate((element) => {
          const body = (element as HTMLIFrameElement).contentDocument?.body;
          return body ? getComputedStyle(body).backgroundColor : null;
        }),
      )
      .not.toBe('rgb(255, 255, 255)');
    await page.screenshot({ path: testInfo.outputPath('epub-reader-1280-light.png') });
  });
});
