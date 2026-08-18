import { describe, expect, it } from 'vitest';
import { type UserLibraryDocument, userLibraryProgressFraction } from '@/state/user-library';
import { pageHasEnoughNativeText } from '@/state/user-library-ingest-helpers';

describe('user-library ingest helpers', () => {
  it('treats pages with enough native text as digital', () => {
    expect(pageHasEnoughNativeText('Короткий текст')).toBe(false);
    expect(
      pageHasEnoughNativeText(
        'Достаточно длинный фрагмент текста для пропуска OCR на этой странице.',
      ),
    ).toBe(true);
  });

  it('marks a PDF as ready when no OCR pages remain', () => {
    const readyDocument: UserLibraryDocument = {
      id: 'user-doc-1',
      title: 'Книга',
      fileName: 'book.pdf',
      mimeType: 'application/pdf',
      byteLength: 1000,
      pageCount: 3,
      nativeTextPages: 2,
      ocrDonePages: 1,
      ocrNeededPages: 1,
      status: 'ready',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    expect(userLibraryProgressFraction(readyDocument)).toBe(1);
  });

  it('keeps pending OCR pages out of the ready fraction until done', () => {
    const ocrDocument: UserLibraryDocument = {
      id: 'user-doc-2',
      title: 'Скан',
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      byteLength: 1000,
      pageCount: 5,
      nativeTextPages: 1,
      ocrDonePages: 1,
      ocrNeededPages: 4,
      status: 'ocr',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    expect(userLibraryProgressFraction(ocrDocument)).toBe(0.4);
  });
});
