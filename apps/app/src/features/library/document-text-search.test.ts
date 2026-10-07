import { describe, expect, it } from 'vitest';

import {
  documentTextBlockSearchText,
  documentTextSearchText,
} from '@/features/library/document-text-search';

describe('documentTextSearchText', () => {
  it('counts the text the page shows, one block per line, without bold markers', () => {
    expect(documentTextSearchText('Первый **абзац**.\n\n- пункт списка\n\n1. шаг')).toBe(
      'Первый абзац.\nпункт списка\nшаг',
    );
  });

  it('leaves the alt text of a reference image out: the page shows only the picture', () => {
    const text = 'До.\n\n![ЭКГ при ишемии](https://example.org/ecg.png)\n\nПосле.';
    expect(documentTextSearchText(text)).toBe('До.\nПосле.');
  });

  it('gives an image block no search text and keeps it out of the offsets', () => {
    expect(
      documentTextBlockSearchText({ kind: 'image', alt: 'ЭКГ', source: 'https://example.org/a' }),
    ).toBeNull();
    expect(documentTextBlockSearchText({ kind: 'paragraph', text: 'А **б**' })).toBe('А б');
  });
});
