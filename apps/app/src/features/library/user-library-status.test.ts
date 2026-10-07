import { describe, expect, it } from 'vitest';

import {
  formatFileSize,
  userLibraryFormatLabel,
  userLibraryStatusParts,
} from '@/features/library/user-library-status';
import type { UserLibraryDocument } from '@/state/user-library';

function documentOf(overrides: Partial<UserLibraryDocument>): UserLibraryDocument {
  return {
    id: 'doc',
    title: 'big-book',
    fileName: 'big-book.epub',
    mimeType: 'application/epub+zip',
    byteLength: 105 * 1024,
    pageCount: 3,
    nativeTextPages: 3,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'ready',
    createdAt: '2026-10-07T02:10:00.000Z',
    updatedAt: '2026-10-07T02:10:00.000Z',
    ...overrides,
  };
}

describe('userLibraryStatusParts', () => {
  it('names the format so two files with one base name differ', () => {
    const epub = userLibraryStatusParts(documentOf({}), null);
    const pdf = userLibraryStatusParts(
      documentOf({ fileName: 'big-book.pdf', mimeType: 'application/pdf', hasTextLayer: true }),
      null,
    );
    expect(epub).toHaveLength(1);
    expect(epub[0]).toMatch(/^EPUB · 105 КБ · /u);
    expect(pdf[0]).toBe('Текстовый слой найден');
    expect(pdf[1]).toMatch(/^PDF · 105 КБ · /u);
  });

  it('keeps the status of a file being read, failed or waiting for recognition', () => {
    expect(userLibraryStatusParts(documentOf({ status: 'inspecting' }), null)).toEqual([
      'Читаем файл…',
    ]);
    expect(
      userLibraryStatusParts(
        documentOf({ status: 'failed', errorMessage: 'Файл повреждён.' }),
        null,
      ),
    ).toEqual(['Файл повреждён.']);
    expect(userLibraryStatusParts(documentOf({ status: 'failed' }), null)).toEqual([
      'Не удалось обработать файл',
    ]);
    expect(userLibraryStatusParts(documentOf({ status: 'ocr' }), 'other')).toEqual([
      'В очереди на распознавание текста',
    ]);
    expect(
      userLibraryStatusParts(
        documentOf({ status: 'ocr', nativeTextPages: 1, ocrDonePages: 1 }),
        'doc',
      ),
    ).toEqual(['Распознавание текста · 2 / 3']);
  });
});

describe('formatters', () => {
  it('formats sizes and extensions', () => {
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(5.4 * 1024 * 1024)).toBe('5.4 МБ');
    expect(userLibraryFormatLabel('Scan.NII.GZ')).toBe('NII.GZ');
    expect(userLibraryFormatLabel('README')).toBe('');
  });
});
