import { describe, expect, it } from 'vitest';

import { readerDocumentSource } from '@/features/library/reader-document-source';

describe('readerDocumentSource', () => {
  it('names the publisher, links the page and dates the fetch', () => {
    expect(
      readerDocumentSource({
        sourceType: 'medical_reference',
        metadata: {
          publisher: 'psihosintez.ru',
          officialSourceUrl: 'https://psihosintez.ru/sensomotorniy-psihosintez/',
          fetchedAt: '2026-10-25T09:00:23Z',
        },
      }),
    ).toEqual({
      name: 'psihosintez.ru',
      url: 'https://psihosintez.ru/sensomotorniy-psihosintez/',
      fetchedOn: '25.10.2026',
    });
  });

  it('falls back to the host when no publisher is named', () => {
    expect(
      readerDocumentSource({
        sourceType: 'krasotaimedicina_reference',
        metadata: {
          officialSourceUrl: 'https://www.krasotaimedicina.ru/diseases/zabolevanija_lor/angina',
        },
      }),
    ).toEqual({
      name: 'krasotaimedicina.ru',
      url: 'https://www.krasotaimedicina.ru/diseases/zabolevanija_lor/angina',
      fetchedOn: null,
    });
  });

  it('does not link a non-https address', () => {
    expect(
      readerDocumentSource({
        sourceType: 'medical_reference',
        metadata: { publisher: 'Пример', officialSourceUrl: 'javascript:alert(1)' },
      }),
    ).toEqual({ name: 'Пример', url: null, fetchedOn: null });
  });

  it('gives nothing for a drug instruction or a document without a source', () => {
    expect(
      readerDocumentSource({
        sourceType: 'official_drug_instruction',
        metadata: { publisher: 'ГРЛС', officialSourceUrl: 'https://grls.rosminzdrav.ru/' },
      }),
    ).toBeNull();
    expect(readerDocumentSource({ sourceType: 'medical_reference', metadata: {} })).toBeNull();
  });
});
