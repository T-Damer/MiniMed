import { describe, expect, it } from 'vitest';

import type {
  ConditionCatalogEntry,
  ConditionCatalogSource,
} from '@/features/conditions/condition-catalog';
import {
  icdCodesRelated,
  MAX_SKIN_DOCUMENT_LINKS,
  skinClassDocumentLinks,
  skinSearchHash,
} from '@/features/skin/skin-document-links';

function source(
  documentId: string,
  title: string,
  kind: ConditionCatalogSource['kind'],
): ConditionCatalogSource {
  return { documentId, title, sourceType: kind, kind, pointer: false };
}

function entry(
  id: string,
  codes: readonly string[],
  sources: readonly ConditionCatalogSource[],
): ConditionCatalogEntry {
  return {
    id,
    title: id,
    codes,
    section: 'diseases',
    searchTerms: [],
    definitions: [],
    sources,
  };
}

describe('related МКБ-10 codes', () => {
  it('matches a category with its subcodes in both directions', () => {
    expect(icdCodesRelated('L40', 'L40.0')).toBe(true);
    expect(icdCodesRelated('L30.9', 'L30')).toBe(true);
    expect(icdCodesRelated('L30.9', 'L30.9')).toBe(true);
  });

  it('does not match neighbours or ranges', () => {
    expect(icdCodesRelated('L40', 'L4')).toBe(false);
    expect(icdCodesRelated('L40', 'L400')).toBe(false);
    expect(icdCodesRelated('L40', 'L10-L14')).toBe(false);
  });
});

describe('document links for a condition', () => {
  const catalog = [
    entry('code:L40.0', ['L40.0'], [source('km', 'Псориаз — статья', 'reference')]),
    entry(
      'code:L40',
      ['L40'],
      [
        source('kr', 'Псориаз — клинические рекомендации', 'recommendation'),
        source('mkb', 'L40 Псориаз', 'classification'),
      ],
    ),
    entry('code:L50', ['L50'], [source('urt', 'Крапивница', 'recommendation')]),
  ];

  it('lists recommendations first, then articles, then the classification', () => {
    expect(skinClassDocumentLinks(catalog, ['L40']).map((link) => link.documentId)).toEqual([
      'kr',
      'km',
      'mkb',
    ]);
  });

  it('takes every code of the class and each document once', () => {
    const links = skinClassDocumentLinks(catalog, ['L40', 'L40.0', 'L50']);
    expect(new Set(links.map((link) => link.documentId)).size).toBe(links.length);
    expect(links.map((link) => link.documentId)).toContain('urt');
  });

  it('is empty for a class without codes or a code no module carries', () => {
    expect(skinClassDocumentLinks(catalog, [])).toEqual([]);
    expect(skinClassDocumentLinks(catalog, ['C43'])).toEqual([]);
  });

  it('keeps the list short', () => {
    const many = entry(
      'code:L20',
      ['L20'],
      Array.from({ length: 9 }, (_, index) => source(`d${index}`, `Статья ${index}`, 'reference')),
    );
    expect(skinClassDocumentLinks([many], ['L20'])).toHaveLength(MAX_SKIN_DOCUMENT_LINKS);
  });

  it('falls back to the app search for the name', () => {
    expect(skinSearchHash('Псориаз')).toBe('#/search?q=%D0%9F%D1%81%D0%BE%D1%80%D0%B8%D0%B0%D0%B7');
  });
});
