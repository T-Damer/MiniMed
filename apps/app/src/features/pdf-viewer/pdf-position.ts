/**
 * Where the user stopped reading each PDF: page, offset inside the page and zoom. Kept only in
 * this browser profile (no content, no file names), newest 150 documents.
 */

export const PDF_POSITION_KEY = 'minimed.pdf-position.v1';
export const PDF_POSITION_LIMIT = 150;

export type PdfFitMode = 'width' | 'page' | 'custom';

export interface PdfReadingPosition {
  /** 1-based page that holds the reading line. */
  readonly page: number;
  /** 0–1: how far down that page the reading line is. */
  readonly fraction: number;
  readonly zoom: number;
  readonly fit: PdfFitMode;
  readonly savedAt: number;
}

export interface PdfPositionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PdfPositionStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parsePdfPosition(value: unknown): PdfReadingPosition | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { page, fraction, zoom, fit, savedAt } = record;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000) {
    return undefined;
  }
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return undefined;
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return undefined;
  if (fit !== 'width' && fit !== 'page' && fit !== 'custom') return undefined;
  return {
    page,
    fraction: clamp(fraction, 0, 1),
    zoom: clamp(zoom, 0.25, 8),
    fit,
    savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
  };
}

function readAll(storage: PdfPositionStorage): Record<string, PdfReadingPosition> {
  const raw = storage.getItem(PDF_POSITION_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, PdfReadingPosition> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      const position = parsePdfPosition(entry);
      if (position && key.length <= 160) result[key] = position;
    }
    return result;
  } catch (cause) {
    console.warn(
      `Stored PDF positions are unreadable: ${cause instanceof Error ? cause.name : 'unknown error'}.`,
    );
    return {};
  }
}

export function loadPdfPosition(
  documentKey: string,
  storage: PdfPositionStorage | undefined = defaultStorage(),
): PdfReadingPosition | undefined {
  if (!storage) return undefined;
  try {
    return readAll(storage)[documentKey];
  } catch (cause) {
    console.warn('PDF position storage is unavailable.', cause);
    return undefined;
  }
}

export function savePdfPosition(
  documentKey: string,
  position: PdfReadingPosition,
  storage: PdfPositionStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const all = { ...readAll(storage), [documentKey]: position };
    const newest = Object.entries(all)
      .toSorted((left, right) => right[1].savedAt - left[1].savedAt)
      .slice(0, PDF_POSITION_LIMIT);
    storage.setItem(PDF_POSITION_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch (cause) {
    // Storage may be full or blocked; the position is a convenience, never required.
    console.warn('PDF position was not saved.', cause);
  }
}

/** Page and offset of the reading line, from the page rectangles relative to the same origin. */
export function readingPositionFromRects(
  pages: readonly { readonly top: number; readonly height: number }[],
  readingLine: number,
  /** A page whose top is this close below the line counts as reached (scroll snaps to pixels). */
  tolerance = 2,
): { readonly page: number; readonly fraction: number } {
  if (pages.length === 0) return { page: 1, fraction: 0 };
  let index = 0;
  for (let current = 0; current < pages.length; current += 1) {
    const rect = pages[current];
    if (!rect) continue;
    if (rect.top > readingLine + tolerance) break;
    index = current;
  }
  const rect = pages[index];
  const fraction =
    rect && rect.height > 0 ? clamp((readingLine - rect.top) / rect.height, 0, 1) : 0;
  return { page: index + 1, fraction };
}

/**
 * The page that fills most of the visible band (1-based); on a tie the earlier page. This is the
 * "current page" of the page box, as in the Chromium viewer.
 */
export function mostVisiblePage(
  pages: readonly { readonly top: number; readonly height: number }[],
  visibleTop: number,
  visibleBottom: number,
): number {
  let best = 0;
  let bestOverlap = -1;
  for (let index = 0; index < pages.length; index += 1) {
    const rect = pages[index];
    if (!rect) continue;
    if (rect.top >= visibleBottom) break;
    const overlap =
      Math.min(rect.top + rect.height, visibleBottom) - Math.max(rect.top, visibleTop);
    if (overlap > bestOverlap) {
      best = index;
      bestOverlap = overlap;
    }
  }
  return best + 1;
}
