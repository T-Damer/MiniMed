import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticPdf } from './synthetic-pdf';

/**
 * A highlight made in one edition of a document follows its text into the next edition: moved
 * paragraphs, changed punctuation, inserted sentences and light rewording. Editions are simulated
 * the way `replaceUserLibraryFile` produces them: the stored text (or file) of the same document
 * id is replaced, then the document is opened again.
 */

const LIBRARY_DB = 'minimed-user-library-v1';
const HIGHLIGHT_DB = 'minimed-user-highlights-v1';

const EDITION_A = [
  'Артериальная гипертензия — синдром повышения давления.',
  'Пациентам рекомендуется ограничение потребления поваренной соли до 5 г/сут, так как это снижает давление.',
  'Контроль эффективности лечения проводится через 2–4 недели.',
].join('\n\n');

const QUOTE = 'ограничение потребления поваренной соли до 5 г/сут';

/** Same words in another place, with « » quotes, a colon and a semicolon. */
const EDITION_B = [
  'Новая редакция рекомендаций. Контроль эффективности лечения проводится через 2–4 недели.',
  'Артериальная гипертензия — синдром повышения давления. Пациентам рекомендуется: ограничение потребления «поваренной» соли до 5 г/сут; это снижает давление.',
].join('\n\n');

/** The sentence reworded a little. */
const EDITION_C = [
  'Артериальная гипертензия — синдром повышения давления.',
  'Пациентам рекомендуется ограничить потребление поваренной соли до 5 г в сутки, так как это снижает давление.',
].join('\n\n');

/** The sentence is gone. */
const EDITION_D = [
  'Артериальная гипертензия — синдром повышения давления.',
  'Контроль эффективности лечения проводится через 2–4 недели.',
].join('\n\n');

async function openLibrary(page: Page): Promise<void> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  // When the search core becomes ready the knowledge-base screens re-render; open the reader after.
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
}

async function upload(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.locator('.user-library-page__file-input').setInputFiles(file);
  await expect(
    page.locator('.user-library-card').filter({ hasText: file.name.replace(/\.[^.]+$/u, '') }),
  ).toHaveAttribute('draggable', 'true');
}

function card(page: Page, name: string) {
  return page.locator('.user-library-card').filter({ hasText: name });
}

async function reopen(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Ваши документы', exact: true }).click();
  await card(page, name).click();
}

/** Replaces the stored text of the document's only page, as a new edition of the file would. */
async function replaceText(page: Page, fileName: string, text: string): Promise<string> {
  return page.evaluate(
    async ({ db, fileName: name, text: next }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const documents = await new Promise<{ id: string; fileName: string }[]>((resolve) => {
        const request = database.transaction('documents').objectStore('documents').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      const document = documents.find((item) => item.fileName === name);
      if (!document) throw new Error('document not found');
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('pages', 'readwrite');
        const store = transaction.objectStore('pages');
        const request = store.get(`${document.id}:0`);
        request.onsuccess = () => {
          store.put({ ...request.result, text: next }, `${document.id}:0`);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return document.id;
    },
    { db: LIBRARY_DB, fileName, text },
  );
}

interface StoredHighlight {
  id: string;
  documentId: string;
  pageAnchor: string;
  start: number;
  end: number;
  quote: string;
  anchorStatus?: string;
  anchorMethod?: string;
  selector?: { exact: string; prefix: string; suffix: string };
  origin?: { pageAnchor: string; start: number; end: number };
  dismissed?: boolean;
}

async function storedHighlights(page: Page): Promise<StoredHighlight[]> {
  return page.evaluate(
    (db) =>
      new Promise<StoredHighlight[]>((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onsuccess = () => {
          const database = request.result;
          const all = database.transaction('highlights').objectStore('highlights').getAll();
          all.onsuccess = () => {
            database.close();
            resolve(all.result as StoredHighlight[]);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    HIGHLIGHT_DB,
  );
}

function rangeCount(page: Page, name: string): Promise<number> {
  return page.evaluate(
    (highlightName) =>
      (CSS.highlights as unknown as Map<string, { size: number }>).get(highlightName)?.size ?? 0,
    name,
  );
}

function paintedText(page: Page, name: string): Promise<string[]> {
  return page.evaluate(
    (highlightName) =>
      [
        ...((CSS.highlights as unknown as Map<string, Iterable<Range>>).get(highlightName) ?? []),
      ].map((range) => range.toString()),
    name,
  );
}

async function selectPhrase(page: Page, phrase: string): Promise<void> {
  await page.evaluate((needle) => {
    const section = document.querySelector('.user-document-reader__text-section');
    if (!section) throw new Error('no text section');
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = (node as Text).data.indexOf(needle);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return;
    }
    throw new Error(`phrase not on the page: ${needle}`);
  }, phrase);
}

test('a text highlight follows its sentence into a newer edition and is never dropped', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openLibrary(page);
  await upload(page, {
    name: 'guideline-edition.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(EDITION_A),
  });
  await card(page, 'guideline-edition').click();
  await page.locator('.user-document-reader__text-section').first().waitFor();

  // Edition A: select the sentence and mark it.
  await selectPhrase(page, QUOTE);
  await page.getByRole('button', { name: 'Выделить: синий' }).click();
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBe(1);
  const [first] = await storedHighlights(page);
  expect(first?.selector?.exact).toBe(QUOTE);
  expect(first?.selector?.prefix).toContain('рекомендуется');
  expect(first?.selector?.suffix).toContain('так как это снижает');

  // Edition B: the paragraph moved, quotes and punctuation changed, a sentence was inserted.
  await replaceText(page, 'guideline-edition.txt', EDITION_B);
  await reopen(page, 'guideline-edition');
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBe(1);
  expect((await paintedText(page, 'user-doc-highlights-blue'))[0]).toBe(
    'ограничение потребления «поваренной» соли до 5 г/сут',
  );
  await expect.poll(async () => (await storedHighlights(page))[0]?.anchorStatus).toBe('moved');
  const moved = (await storedHighlights(page))[0];
  expect(moved?.origin?.start).toBe(first?.start);
  expect(moved?.id).toBe(first?.id);
  expect(await rangeCount(page, 'user-doc-highlights-approximate')).toBe(0);

  // Edition C: lightly reworded — carried over and marked as approximate.
  await replaceText(page, 'guideline-edition.txt', EDITION_C);
  await reopen(page, 'guideline-edition');
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBe(1);
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-approximate')).toBe(1);
  expect((await paintedText(page, 'user-doc-highlights-blue'))[0]).toContain('потребление');
  await expect
    .poll(async () => (await storedHighlights(page))[0]?.anchorStatus)
    .toBe('approximate');

  // Edition D: the sentence is gone — nothing is painted, the highlight is kept and listed.
  await replaceText(page, 'guideline-edition.txt', EDITION_D);
  await reopen(page, 'guideline-edition');
  await expect.poll(async () => (await storedHighlights(page))[0]?.anchorStatus).toBe('missing');
  expect(await rangeCount(page, 'user-doc-highlights-blue')).toBe(0);
  expect(await storedHighlights(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Меню действий' }).click();
  await page.getByRole('menuitem', { name: 'Выделения' }).click();
  await expect(page.locator('.document-highlights__heading')).toHaveText(
    'Не найдено в новой редакции',
  );
  await expect(page.locator('.document-highlights__quote')).toContainText('потребление');
  await expect(page.locator('.document-highlights__jump').first()).toBeDisabled();
  await page.keyboard.press('Escape');

  // The text comes back in a later edition: the kept highlight is found again.
  await replaceText(page, 'guideline-edition.txt', EDITION_B);
  await reopen(page, 'guideline-edition');
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBe(1);
  await expect.poll(async () => (await storedHighlights(page))[0]?.anchorStatus).toBe('moved');
});

test('highlights saved before text-quote anchors existed are kept and upgraded', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLibrary(page);
  await upload(page, {
    name: 'legacy-highlights.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(EDITION_A),
  });
  const documentId = await replaceText(page, 'legacy-highlights.txt', EDITION_A);
  const start = EDITION_A.indexOf(QUOTE);
  // A version-1 database exactly as the previous app wrote it: no selector, no status, no origin.
  await page.evaluate(
    async ({ db, documentId: id, start: from, quote }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(db);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(db, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('highlights', { keyPath: 'id' });
          store.createIndex('documentId', 'documentId', { unique: false });
          store.put({
            id: 'hl-legacy-1',
            documentId: id,
            pageAnchor: `user-doc-anchor-${id}-0`,
            start: from,
            end: from + quote.length,
            quote,
            color: 'green',
            createdAt: '2026-09-01T10:00:00.000Z',
          });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    },
    { db: HIGHLIGHT_DB, documentId, start, quote: QUOTE },
  );
  await card(page, 'legacy-highlights').click();
  await page.locator('.user-document-reader__text-section').first().waitFor();
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-green')).toBe(1);
  expect((await paintedText(page, 'user-doc-highlights-green'))[0]).toBe(QUOTE);
  await expect
    .poll(async () => (await storedHighlights(page))[0]?.selector?.prefix ?? '')
    .toContain('рекомендуется');
  const [upgraded] = await storedHighlights(page);
  expect(upgraded).toMatchObject({
    id: 'hl-legacy-1',
    quote: QUOTE,
    anchorStatus: 'exact',
    selector: { exact: QUOTE },
    origin: { start },
  });
  expect(
    await page.evaluate(
      (db) => indexedDB.databases().then((all) => all.find((item) => item.name === db)?.version),
      HIGHLIGHT_DB,
    ),
  ).toBe(2);
});

const PDF_EDITION_A = (pageIndex: number): readonly string[] =>
  [
    [
      'Guideline for adults',
      'Salt intake should be restricted to 5 g per day in adults,',
      'because it lowers blood pressure.',
    ],
    [
      'Follow-up visits',
      'Control of treatment is performed after 2 to 4 weeks.',
      'Repeat the measurement at each visit.',
    ],
    ['Appendix', 'Drug doses are listed in the table.', 'See the manufacturer instructions.'],
  ][pageIndex] ?? [];

/** Pages reordered, an introductory page added, and the sentence reworded a little. */
const PDF_EDITION_B = (pageIndex: number): readonly string[] =>
  [
    ['Second edition', 'New introductory page for the revised guideline.'],
    [
      'Follow-up visits',
      'Control of treatment is performed after 2 to 4 weeks.',
      'Repeat the measurement at each visit.',
    ],
    [
      'Guideline for adults',
      'Salt intake must be restricted to 5 g/day in adults,',
      'because it lowers blood pressure.',
    ],
    ['Appendix', 'Drug doses are listed in the table.', 'See the manufacturer instructions.'],
  ][pageIndex] ?? [];

test('a PDF text highlight is saved on the text layer and follows its text into a newer file', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  await upload(page, {
    name: 'adult-guideline.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticPdf({ pages: 3, lines: PDF_EDITION_A }),
  });
  await expect(card(page, 'adult-guideline').first()).toContainText('Текстовый слой найден');
  await card(page, 'adult-guideline').first().click();
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(3);
  await expect(page.locator('.user-document-reader__banner')).toHaveCount(0, { timeout: 60_000 });

  // Select the whole line on the text layer and mark it.
  const line = page.locator('.pdf-viewer__text-run', { hasText: 'Salt intake should be' }).first();
  await line.waitFor({ state: 'attached', timeout: 30_000 });
  await line.click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Выделить: синий' }).click();
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBeGreaterThan(0);
  const [saved] = await storedHighlights(page);
  expect(saved?.pageAnchor).toBe('pdf-page-0');
  expect(saved?.quote).toContain('Salt intake should be restricted');
  expect(saved?.selector?.exact).toContain('Salt intake should be restricted');

  // Reopen: still painted from the stored anchor.
  await reopenPdf(page);
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBeGreaterThan(0);

  // A newer file of the same document: the sentence is on another page and slightly reworded.
  await page.evaluate(
    async ({ db, base64 }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const documents = await new Promise<{ id: string; fileName: string }[]>((resolve) => {
        const request = database.transaction('documents').objectStore('documents').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      const document = documents.find((item) => item.fileName === 'adult-guideline.pdf');
      if (!document) throw new Error('document not found');
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite');
        transaction
          .objectStore('files')
          .put(new Blob([bytes], { type: 'application/pdf' }), document.id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      db: LIBRARY_DB,
      base64: syntheticPdf({ pages: 4, lines: PDF_EDITION_B }).toString('base64'),
    },
  );
  await reopenPdf(page, 4);
  await expect.poll(async () => (await storedHighlights(page))[0]?.pageAnchor).toBe('pdf-page-2');
  // The new page is off screen: scroll to it so its text layer is drawn.
  await page.getByRole('textbox', { name: 'Номер страницы' }).fill('3');
  await page.keyboard.press('Enter');
  const [moved] = await storedHighlights(page);
  expect(moved?.anchorStatus).toBe('approximate');
  expect(moved?.origin?.pageAnchor).toBe('pdf-page-0');
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-blue')).toBeGreaterThan(0);
  await expect.poll(() => rangeCount(page, 'user-doc-highlights-approximate')).toBeGreaterThan(0);
});

async function reopenPdf(page: Page, pages = 3): Promise<void> {
  await page.getByRole('link', { name: 'Ваши документы', exact: true }).click();
  await card(page, 'adult-guideline').first().click();
  await expect(page.locator('.pdf-viewer__page')).toHaveCount(pages);
  await expect(page.locator('.pdf-viewer__text-run').first()).toBeAttached({ timeout: 30_000 });
}
