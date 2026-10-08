import { expect, type Page, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

async function openClinicalDocument(page: Page): Promise<void> {
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();
}

/** Selects `length` characters of the n-th text chunk's first text node, from `from`. */
async function selectInChunk(
  page: Page,
  chunkIndex: number,
  from: number,
  length: number,
): Promise<string> {
  return page.evaluate(
    ({ chunkIndex: index, from: start, length: count }) => {
      const chunk = document.querySelectorAll('.document-text-chunk')[index];
      if (!chunk) throw new Error('chunk not found');
      const node = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
      if (!node) throw new Error('chunk has no text');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(node.data.length, start + count));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return range.toString();
    },
    { chunkIndex, from, length },
  );
}

/** Selects from near the end of one chunk to near the start of the next. */
async function selectAcrossChunks(page: Page, first: number): Promise<void> {
  await page.evaluate((index) => {
    const chunks = document.querySelectorAll('.document-text-chunk');
    const from = chunks[index];
    const to = chunks[index + 1];
    if (!from || !to) throw new Error('need two chunks');
    const fromText = document.createTreeWalker(from, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const toText = document.createTreeWalker(to, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(fromText, Math.max(0, fromText.data.length - 12));
    range.setEnd(toText, Math.min(toText.data.length, 12));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, first);
}

/** The page scrolls smoothly and a popup follows its text, so wait until the scroll has stopped. */
async function settleScroll(page: Page): Promise<void> {
  let previous = Number.NaN;
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.scrollY);
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
}

async function scrollChunkTo(page: Page, index: number, top: number): Promise<void> {
  await page.evaluate(
    ({ index: chunk, top: target }) => {
      const element = document.querySelectorAll('.document-text-chunk')[chunk];
      const current = element?.getBoundingClientRect().top ?? 0;
      window.scrollBy({ top: current - target, behavior: 'instant' });
    },
    { index, top },
  );
  await settleScroll(page);
}

const paintedRanges = (page: Page, color = 'yellow') =>
  page.evaluate(
    (name) =>
      (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(name)?.size ?? 0,
    `user-doc-highlights-${color}`,
  );

test('numbered sub-headings are headings, and a selection in the text can be highlighted', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openClinicalDocument(page);

  // «1.2.1 Этиология» is a heading in the stored text since the KR3 rebuild (it was a plain paragraph
  // the reader promoted before): either way it shows once, as an h4, in the outline and not as body text.
  const heading = page
    .locator('.document-overlay-section__title')
    .filter({ hasText: /^1\.2\.1\s+Этиология/u });
  await expect(heading).toHaveCount(1, { timeout: 60_000 });
  // Three number components make an h4 below the document's h1.
  await expect(heading).toHaveJSProperty('tagName', 'H4');
  await expect(
    page
      .locator('.document-overlay-outline-section-button__label')
      .filter({ hasText: /^1\.2\.1\s+Этиология/u }),
  ).toHaveCount(1);
  const leftovers = await page
    .locator('.document-overlay-section__paragraph')
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => /^1\.2\.1\s+Этиология\s*$/u.test(node.textContent ?? '')).length,
    );
  expect(leftovers).toBe(0);
  // The heading stands alone: no small uppercase path («1. КРАТКАЯ ИНФОРМАЦИЯ / 1.2 …») above it.
  expect(await heading.evaluate((node) => node.previousElementSibling?.tagName ?? null)).toBeNull();

  await scrollChunkTo(page, 2, 300);
  const selected = await selectInChunk(page, 2, 0, 24);
  expect(selected.length).toBeGreaterThan(10);
  const popup = page.locator('.user-highlight-popup');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.user-highlight-popup__color')).toHaveCount(5);
  await popup.getByRole('button', { name: /жёлтый/iu }).click();
  await expect(popup).toHaveCount(0);
  await expect.poll(() => paintedRanges(page)).toBe(1);

  // A selection across two chunks becomes one mark per chunk.
  await scrollChunkTo(page, 3, 300);
  await selectAcrossChunks(page, 3);
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: /зелёный/iu }).click();
  await expect.poll(() => paintedRanges(page, 'green')).toBe(2);

  // The marks come back after a reload.
  await page.reload();
  await page.locator('.document-overlay-section__title').first().waitFor();
  await expect.poll(() => paintedRanges(page), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => paintedRanges(page, 'green')).toBe(2);

  // A click on a mark offers to remove it.
  await scrollChunkTo(page, 2, 300);
  const point = await page.evaluate(() => {
    const ranges = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
      'user-doc-highlights-yellow',
    );
    const range = ranges ? [...ranges][0] : undefined;
    const rect = range?.getClientRects()[0];
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  });
  if (!point) throw new Error('highlight has no box');
  await page.mouse.click(point.x, point.y);
  await popup.getByRole('button', { name: /Убрать выделение/u }).click();
  await expect.poll(() => paintedRanges(page)).toBe(0);
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the popup sits below the selection, clear of the system menu, and docks near the bottom', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openClinicalDocument(page);
    const popup = page.locator('.user-highlight-popup');

    // Room under the selection: the popup goes below it, past the drag handles.
    await scrollChunkTo(page, 2, 160);
    await selectInChunk(page, 2, 0, 24);
    await expect(popup).toBeVisible();
    await expect(popup).toHaveClass(/user-highlight-popup--below/u);
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom } : null;
    });
    const box = await popup.boundingBox();
    if (!selection || !box) throw new Error('missing geometry');
    expect(box.y).toBeGreaterThan(selection.bottom + 16);
    await page.screenshot({ path: 'playwright/test-results/kr-highlight-popup-390.png' });

    // The selection sits at the bottom edge: the popup docks above the bottom navigation.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await expect(popup).toHaveCount(0);
    await scrollChunkTo(page, 2, 700);
    await selectInChunk(page, 2, 0, 24);
    await expect(popup).toBeVisible();
    await expect(popup).toHaveClass(/user-highlight-popup--dock/u);
    const docked = await popup.boundingBox();
    if (!docked) throw new Error('missing geometry');
    expect(docked.y + docked.height).toBeLessThanOrEqual(844);
  });
});
