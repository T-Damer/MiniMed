import type { MedicalDocumentSummary, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  inferRequestedAudience,
  rankSearchGroupsByAudience,
} from '@/features/search/ScopedMedicalCore';

function document(id: string, ageGroups: readonly string[]): MedicalDocumentSummary {
  return {
    id,
    title: id,
    shortTitle: null,
    sourceType: 'clinical_recommendation',
    status: 'active',
    specialties: [],
    ageGroups,
    versionId: `${id}@1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

function group(documentId: string): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: ['other'],
    results: [],
  };
}

describe('search audience inference', () => {
  it('recognizes pediatric, adult and explicit age wording without treating drug numbers as age', () => {
    expect(inferRequestedAudience('ребенок 7 лет, бронхиальная астма')).toBe('children');
    expect(inferRequestedAudience('грудничок свистит при дыхании')).toBe('children');
    expect(inferRequestedAudience('взрослый пациент с ХОБЛ')).toBe('adults');
    expect(inferRequestedAudience('пациент 54 года, диабет 2 типа')).toBe('adults');
    expect(inferRequestedAudience('диабет 2 типа')).toBeUndefined();
    expect(inferRequestedAudience('чем отличаются критерии у детей и взрослых')).toBeUndefined();
  });
});

describe('age-aware result ordering', () => {
  const documents = [
    document('adult', ['adults']),
    document('unknown', []),
    document('child', ['children']),
    document('mixed', ['children', 'adults']),
  ];

  it('places pediatric and mixed-audience sources before adult-only fallback for a child query', () => {
    const ranked = rankSearchGroupsByAudience(
      [group('adult'), group('unknown'), group('child'), group('mixed')],
      documents,
      'children',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['child', 'mixed', 'unknown', 'adult']);
    expect(ranked[0]?.ageGroups).toEqual(['children']);
    expect(ranked[3]?.ageGroups).toEqual(['adults']);
  });

  it('places adult sources first for an adult query and keeps an adult source as fallback when alone', () => {
    const ranked = rankSearchGroupsByAudience(
      [group('child'), group('adult'), group('unknown')],
      documents,
      'adults',
    );
    expect(ranked.map((item) => item.documentId)).toEqual(['adult', 'unknown', 'child']);

    const fallback = rankSearchGroupsByAudience([group('adult')], documents, 'children');
    expect(fallback.map((item) => item.documentId)).toEqual(['adult']);
    expect(fallback[0]?.ageGroups).toEqual(['adults']);
  });

  it('preserves score order when no audience is expressed', () => {
    const ranked = rankSearchGroupsByAudience(
      [group('adult'), group('child'), group('unknown')],
      documents,
      undefined,
    );
    expect(ranked.map((item) => item.documentId)).toEqual(['adult', 'child', 'unknown']);
  });
});
