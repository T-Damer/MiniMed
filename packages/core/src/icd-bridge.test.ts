import type { SearchDocumentDescriptor } from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import {
  documentIcdCodes,
  IcdRecommendationIndex,
  isRecommendationDocument,
  titleCoverage,
} from './icd-bridge';

const document = (
  id: string,
  metadata: Record<string, unknown>,
  sourceType = 'core_catalog_pointer',
): SearchDocumentDescriptor => ({ id, title: id, shortTitle: null, sourceType, metadata });

const recommendation = (id: string, codes: readonly string[]) =>
  document(id, { catalogFamily: 'clinical', icd10Codes: codes });

describe('documentIcdCodes', () => {
  it('reads icd10Codes and mkbCode, upper-cased, and drops what is not a code', () => {
    expect(
      documentIcdCodes(document('card', { icd10Codes: ['j20.9', 'bad', 'K29'], mkbCode: 'J20.9' })),
    ).toEqual(['J20.9', 'K29']);
    expect(documentIcdCodes(document('none', {}))).toEqual([]);
  });
});

describe('isRecommendationDocument', () => {
  it('recognises recommendations by catalog family or source type', () => {
    expect(isRecommendationDocument(recommendation('kr', []))).toBe(true);
    expect(isRecommendationDocument(document('kr2', {}, 'clinical_recommendation'))).toBe(true);
    expect(isRecommendationDocument(document('card', { catalogFamily: 'reference' }))).toBe(false);
  });
});

describe('IcdRecommendationIndex', () => {
  const index = new IcdRecommendationIndex([
    recommendation('kr.exact', ['J20.9', 'J21.0']),
    recommendation('kr.category', ['J20']),
    recommendation('kr.sibling', ['J20.8']),
    recommendation('kr.other', ['K29.3']),
    document('card', { catalogFamily: 'reference', icd10Codes: ['J20.9'] }),
  ]);

  it('lists recommendations covering a code, exact matches before category matches', () => {
    expect(index.recommendationsFor(['J20.9'], false)).toEqual([
      { documentId: 'kr.exact', relation: 3, code: 'J20.9' },
      { documentId: 'kr.category', relation: 2, code: 'J20.9' },
    ]);
  });

  it('lets a card for the whole category reach recommendations of its subcodes', () => {
    expect(index.recommendationsFor(['J20'], false).map((item) => item.documentId)).toEqual([
      'kr.category',
      'kr.exact',
      'kr.sibling',
    ]);
  });

  it('can be restricted to exact code matches', () => {
    expect(index.recommendationsFor(['J20.9'], true).map((item) => item.documentId)).toEqual([
      'kr.exact',
    ]);
  });

  it('never relates sibling subcodes or other categories, and ignores non-recommendations', () => {
    expect(index.recommendationsFor(['J20.9'], false).map((item) => item.documentId)).not.toContain(
      'kr.sibling',
    );
    expect(index.recommendationsFor(['Z99.9'], false)).toEqual([]);
    expect(index.recommendationsFor(['K29.3'], false).map((item) => item.documentId)).toEqual([
      'kr.other',
    ]);
  });
});

describe('titleCoverage', () => {
  it('is the share of query words that the title has, inflections included', () => {
    expect(
      titleCoverage('J20.9 Острый бронхит неуточненный, МКБ-10', 'острый бронхит неуточнённый'),
    ).toBe(1);
    expect(titleCoverage('Острый бронхит', 'острого бронхита у детей')).toBeCloseTo(2 / 3);
    expect(titleCoverage('Острый бронхит', 'аугментин пневмония')).toBe(0);
    expect(titleCoverage('Острый бронхит', 'ок')).toBe(0);
  });
});
