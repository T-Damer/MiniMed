import { createWorker, type Worker } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

import {
  findNextPendingOcrPage,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryImageMime,
  isUserLibraryPdfMime,
  isUserLibraryTextLikeMime,
  listUserLibraryDocuments,
  patchUserLibraryDocument,
  putUserLibraryPage,
  type UserLibraryDocument,
  type UserLibraryOcrQuality,
  type UserLibraryPage,
  type UserLibraryWordBox,
} from '@/state/user-library';
import {
  extractUserLibraryText,
  userLibraryArchiveHasImages,
} from '@/state/user-library-formats';
import { pageHasEnoughNativeText } from '@/state/user-library-ingest-helpers';
import { loadPdfJsDocument, type PdfPageProxy } from '@/state/pdfjs-document';

const TEXT_CHUNK_SIZE = 1200;
const OCR_PAGE_DELAY_MS = 600;
const OCR_WORKER_INIT_TIMEOUT_MS = 20_000;
const OCR_WORKER_INIT_MAX_ATTEMPTS = 2;
const OCR_LANGUAGES = 'rus+eng';
const OCR_OEM = 1;

let ingestLoopRunning = false;
let ocrWorker: Worker | undefined;
let ocrWorkerInitAttempts = 0;

function splitTextIntoPages(text: string, mimeType: string): readonly string[] {
  const normalized = text.replace(/\r\n/gu, '\n');
  if (!normalized.trim()) return [''];
  // Markdown structure must survive ingestion so headings, lists and fenced blocks can be rendered
  // and indexed consistently. Keep Markdown as one logical page instead of cutting syntax at an
  // arbitrary character boundary.
  if (mimeType === 'text/markdown') return [normalized];
  const pages: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    pages.push(normalized.slice(offset, offset + TEXT_CHUNK_SIZE));
    offset += TEXT_CHUNK_SIZE;
  }
  return pages;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeWordBoxes(
  boxes: readonly {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[],
): readonly UserLibraryWordBox[] | undefined {
  const words: UserLibraryWordBox[] = [];
  for (const box of boxes) {
    if (!box.text.trim()) continue;
    words.push({
      text: box.text,
      x: clampUnit(box.x),
      y: clampUnit(box.y),
      w: clampUnit(box.w),
      h: clampUnit(box.h),
    });
  }
  return words.length > 0 ? words : undefined;
}

function multiplyMatrix(a: readonly number[], b: readonly number[]): readonly number[] {
  const a0 = a[0] ?? 0;
  const a1 = a[1] ?? 0;
  const a2 = a[2] ?? 0;
  const a3 = a[3] ?? 0;
  const a4 = a[4] ?? 0;
  const a5 = a[5] ?? 0;
  const b0 = b[0] ?? 0;
  const b1 = b[1] ?? 0;
  const b2 = b[2] ?? 0;
  const b3 = b[3] ?? 0;
  const b4 = b[4] ?? 0;
  const b5 = b[5] ?? 0;
  return [
    a0 * b0 + a2 * b1,
    a1 * b0 + a3 * b1,
    a0 * b2 + a2 * b3,
    a1 * b2 + a3 * b3,
    a0 * b4 + a2 * b5 + a4,
    a1 * b4 + a3 * b5 + a5,
  ];
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} заняла слишком много времени.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForIdle(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, OCR_PAGE_DELAY_MS));
  if ('requestIdleCallback' in window) {
    await new Promise<void>((resolve) => {
      window.requestIdleCallback(() => resolve(), { timeout: OCR_PAGE_DELAY_MS });
    });
  }
}

async function waitWhileHidden(): Promise<void> {
  if (!document.hidden) return;
  await new Promise<void>((resolve) => {
    const handleVisibility = (): void => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', handleVisibility);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
  });
}

async function extractPdfPageContent(
  page: PdfPageProxy,
): Promise<{ readonly text: string; readonly words?: readonly UserLibraryWordBox[] }> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const viewportTransform = viewport.transform;
  const boxes: { text: string; x: number; y: number; w: number; h: number }[] = [];

  for (const item of textContent.items) {
    if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
    const itemTransform = item.transform as readonly number[];
    const transform = multiplyMatrix(viewportTransform, itemTransform);
    const fontHeight = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
    const scaleX = Math.hypot(transform[0] ?? 0, transform[1] ?? 0);
    const itemHeight =
      'height' in item && typeof item.height === 'number' && item.height > 0 ? item.height : 1;
    const x = (transform[4] ?? 0) / viewport.width;
    const y = ((transform[5] ?? 0) - fontHeight) / viewport.height;
    const w = (item.width * scaleX) / itemHeight / viewport.width;
    const h = fontHeight / viewport.height;
    boxes.push({ text: item.str, x, y, w, h });
  }

  const text = textContent.items
    .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const words = normalizeWordBoxes(boxes);
  return words ? { text, words } : { text };
}

function ocrRenderScale(quality: UserLibraryOcrQuality | undefined): number {
  if (quality === 'fast') return 0.9;
  if (quality === 'quality') return 1.55;
  return 1.2;
}

async function renderPdfPageForOcr(
  page: PdfPageProxy,
  quality: UserLibraryOcrQuality | undefined,
): Promise<{ readonly canvas: HTMLCanvasElement; width: number; height: number }> {
  const viewport = page.getViewport({ scale: ocrRenderScale(quality) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить страницу для распознавания.');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return { canvas, width: canvas.width, height: canvas.height };
}

async function renderImageForOcr(
  blob: Blob,
  quality: UserLibraryOcrQuality | undefined,
): Promise<{ readonly canvas: HTMLCanvasElement; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Не удалось загрузить изображение.'));
      element.src = url;
    });
    const scale = quality === 'fast' ? 0.75 : quality === 'quality' ? 1 : 0.9;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение для распознавания.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface TesseractWord {
  readonly text?: string;
  readonly bbox?: {
    readonly x0?: number;
    readonly y0?: number;
    readonly x1?: number;
    readonly y1?: number;
  };
}

function extractTesseractWords(
  words: readonly TesseractWord[] | undefined,
  canvasWidth: number,
  canvasHeight: number,
): readonly UserLibraryWordBox[] | undefined {
  if (!words || canvasWidth <= 0 || canvasHeight <= 0) return undefined;
  const boxes: { text: string; x: number; y: number; w: number; h: number }[] = [];
  for (const word of words) {
    const text = word.text?.trim() ?? '';
    const bbox = word.bbox;
    if (!text || !bbox) continue;
    const x0 = bbox.x0 ?? 0;
    const y0 = bbox.y0 ?? 0;
    const x1 = bbox.x1 ?? x0;
    const y1 = bbox.y1 ?? y0;
    boxes.push({
      text,
      x: x0 / canvasWidth,
      y: y0 / canvasHeight,
      w: (x1 - x0) / canvasWidth,
      h: (y1 - y0) / canvasHeight,
    });
  }
  return normalizeWordBoxes(boxes);
}

async function ensureOcrWorker(): Promise<Worker | null> {
  if (ocrWorker) return ocrWorker;
  if (ocrWorkerInitAttempts >= OCR_WORKER_INIT_MAX_ATTEMPTS) return null;

  ocrWorkerInitAttempts += 1;
  const langPath = new URL('tessdata/', `${window.location.origin}/`).href;
  try {
    ocrWorker = await withTimeout(
      createWorker(OCR_LANGUAGES, OCR_OEM, {
        workerPath,
        corePath,
        langPath,
        workerBlobURL: false,
      }),
      OCR_WORKER_INIT_TIMEOUT_MS,
      'Инициализация OCR',
    );
    return ocrWorker;
  } catch (cause) {
    ocrWorker = undefined;
    console.error('Не удалось инициализировать OCR.', {
      workerPath,
      corePath,
      langPath,
      cause,
    });
    if (ocrWorkerInitAttempts >= OCR_WORKER_INIT_MAX_ATTEMPTS) {
      await failAllOcrDocuments(
        'Не удалось запустить распознавание текста на устройстве. Проверьте, что файлы tessdata доступны в сборке.',
      );
    }
    return null;
  }
}

async function disposeOcrWorker(): Promise<void> {
  if (!ocrWorker) return;
  await ocrWorker.terminate();
  ocrWorker = undefined;
}

export async function processNewDocument(documentId: string): Promise<void> {
  const blob = await getUserLibraryFile(documentId);
  const meta = await getUserLibraryDocument(documentId);
  if (!blob || !meta || meta.status !== 'inspecting') return;

  if (isUserLibraryTextLikeMime(meta.mimeType)) {
    const data = await blob.arrayBuffer();
    const text = await extractUserLibraryText(meta.fileName, meta.mimeType, data);
    const chunks = splitTextIntoPages(text, meta.mimeType);
    const hasImages = await userLibraryArchiveHasImages(meta.fileName, meta.mimeType, data);
    for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
      await putUserLibraryPage({
        documentId,
        pageIndex,
        kind: 'native',
        text: chunks[pageIndex] ?? '',
      });
      await yieldToEventLoop();
    }
    await patchUserLibraryDocument(documentId, {
      pageCount: chunks.length,
      nativeTextPages: chunks.length,
      ocrDonePages: 0,
      ocrNeededPages: 0,
      hasImages,
      status: 'ready',
    });
    ensureUserLibraryIngestRunning();
    return;
  }

  if (isUserLibraryImageMime(meta.mimeType)) {
    await putUserLibraryPage({ documentId, pageIndex: 0, kind: 'pending', text: '' });
    await patchUserLibraryDocument(documentId, {
      pageCount: 1,
      nativeTextPages: 0,
      ocrNeededPages: 1,
      ocrDonePages: 0,
      hasImages: true,
      status: 'ocr',
    });
    ensureUserLibraryIngestRunning();
    return;
  }

  const pdf = await loadPdfJsDocument(blob);
  try {
    const pageCount = pdf.numPages;
    let nativeTextPages = 0;
    let ocrNeededPages = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      try {
        const { text: nativeText, words } = await extractPdfPageContent(page);
        if (pageHasEnoughNativeText(nativeText)) {
          nativeTextPages += 1;
          await putUserLibraryPage(
            buildUserLibraryPage(documentId, pageIndex, 'native', nativeText, words),
          );
        } else {
          ocrNeededPages += 1;
          await putUserLibraryPage({ documentId, pageIndex, kind: 'pending', text: '' });
        }
      } finally {
        page.cleanup();
      }
      await yieldToEventLoop();
    }

    await patchUserLibraryDocument(documentId, {
      pageCount,
      nativeTextPages,
      ocrNeededPages,
      ocrDonePages: 0,
      hasImages: true,
      status: ocrNeededPages === 0 ? 'ready' : 'ocr',
    });
  } finally {
    await pdf.destroy();
  }
  ensureUserLibraryIngestRunning();
}

function buildUserLibraryPage(
  documentId: string,
  pageIndex: number,
  kind: UserLibraryPage['kind'],
  text: string,
  words?: readonly UserLibraryWordBox[],
): UserLibraryPage {
  return words ? { documentId, pageIndex, kind, text, words } : { documentId, pageIndex, kind, text };
}

async function completeOcrPage(
  documentId: string,
  pageIndex: number,
  meta: UserLibraryDocument,
  page: Pick<UserLibraryPage, 'kind' | 'text'> & {
    readonly words?: readonly UserLibraryWordBox[];
  },
): Promise<void> {
  await putUserLibraryPage(
    buildUserLibraryPage(documentId, pageIndex, page.kind, page.text, page.words),
  );
  const updated = await patchUserLibraryDocument(documentId, {
    ocrDonePages: meta.ocrDonePages + 1,
  });
  if (updated && updated.ocrDonePages >= updated.ocrNeededPages) {
    await patchUserLibraryDocument(documentId, { status: 'ready', ocrPriority: 0 });
  }
}

async function failAllOcrDocuments(message: string): Promise<void> {
  const documents = await listUserLibraryDocuments();
  for (const document of documents) {
    if (document.status !== 'ocr') continue;
    await patchUserLibraryDocument(document.id, {
      status: 'failed',
      errorMessage: message,
    });
  }
}

async function processNextOcrPage(): Promise<boolean> {
  await waitWhileHidden();
  const pending = await findNextPendingOcrPage();
  if (!pending) return false;

  const meta = await getUserLibraryDocument(pending.documentId);
  const blob = await getUserLibraryFile(pending.documentId);
  if (!meta || !blob) {
    if (meta) {
      await completeOcrPage(pending.documentId, pending.pageIndex, meta, {
        kind: 'empty',
        text: '',
      });
    } else {
      await putUserLibraryPage({
        documentId: pending.documentId,
        pageIndex: pending.pageIndex,
        kind: 'empty',
        text: '',
      });
    }
    return true;
  }

  const isPdf = isUserLibraryPdfMime(meta.mimeType);
  const isImage = isUserLibraryImageMime(meta.mimeType);
  if (!isPdf && !isImage) {
    await completeOcrPage(pending.documentId, pending.pageIndex, meta, {
      kind: 'empty',
      text: '',
    });
    return true;
  }

  const worker = await ensureOcrWorker();
  if (!worker) return false;

  let canvas: HTMLCanvasElement | undefined;
  try {
    let canvasWidth = 0;
    let canvasHeight = 0;

    if (isPdf) {
      const pdf = await loadPdfJsDocument(blob);
      try {
        const page = await pdf.getPage(pending.pageIndex + 1);
        try {
          const rendered = await renderPdfPageForOcr(page, meta.ocrQuality);
          canvas = rendered.canvas;
          canvasWidth = rendered.width;
          canvasHeight = rendered.height;
        } finally {
          page.cleanup();
        }
      } finally {
        await pdf.destroy();
      }
    } else {
      const rendered = await renderImageForOcr(blob, meta.ocrQuality);
      canvas = rendered.canvas;
      canvasWidth = rendered.width;
      canvasHeight = rendered.height;
    }

    const result = await worker.recognize(canvas);
    const ocrData = result.data as {
      readonly text: string;
      readonly words?: readonly TesseractWord[];
    };
    const recognizedText = ocrData.text.replace(/\s+/gu, ' ').trim();
    const words = extractTesseractWords(ocrData.words, canvasWidth, canvasHeight);
    await completeOcrPage(
      pending.documentId,
      pending.pageIndex,
      meta,
      words
        ? { kind: recognizedText ? 'ocr' : 'empty', text: recognizedText, words }
        : { kind: recognizedText ? 'ocr' : 'empty', text: recognizedText },
    );
  } catch (cause) {
    console.warn('OCR не распознал страницу личного документа.', cause);
    await completeOcrPage(pending.documentId, pending.pageIndex, meta, {
      kind: 'empty',
      text: '',
    });
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  await waitForIdle();
  return true;
}

async function processNextInspectingDocument(): Promise<boolean> {
  const documents = await listUserLibraryDocuments();
  const document = documents
    .filter((item) => item.status === 'inspecting')
    .toSorted((left, right) => {
      const priority = (right.ocrPriority ?? 0) - (left.ocrPriority ?? 0);
      return priority || left.createdAt.localeCompare(right.createdAt);
    })[0];
  if (!document) return false;
  await processNewDocument(document.id);
  return true;
}

async function runIngestLoop(): Promise<void> {
  let preferInspection = true;
  try {
    while (true) {
      let processed = false;
      if (preferInspection) processed = await processNextInspectingDocument();
      if (!processed) processed = await processNextOcrPage();
      if (!processed && !preferInspection) processed = await processNextInspectingDocument();
      if (!processed) break;
      preferInspection = !preferInspection;
      await yieldToEventLoop();
    }
  } finally {
    ingestLoopRunning = false;
    const documents = await listUserLibraryDocuments();
    const hasWork = documents.some(
      (document) => document.status === 'ocr' || document.status === 'inspecting',
    );
    if (hasWork) {
      ensureUserLibraryIngestRunning();
    } else {
      await disposeOcrWorker();
    }
  }
}

export function ensureUserLibraryIngestRunning(): void {
  if (ingestLoopRunning) return;
  ingestLoopRunning = true;
  void runIngestLoop().catch((cause) => {
    ingestLoopRunning = false;
    console.error('Ошибка фоновой обработки личных документов.', cause);
  });
}
