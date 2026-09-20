import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildLookupQualityCases } from './lookup-quality-cases';

function document(
  id: string,
  title: string,
  declaredAliases: readonly string[] = [],
): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: null,
    sourceType: 'medical_reference',
    status: 'active',
    specialties: [],
    versionId: `${id}.v1`,
    versionLabel: '1',
    effectiveFrom: null,
    metadata: { declaredAliases },
  };
}

describe('corpus-derived lookup quality cases', () => {
  it('groups collisions instead of inventing one gold document', () => {
    const cases = buildLookupQualityCases([
      document('a', 'Шкала ABC'),
      document('b', 'Другой документ', ['Шкала ABC']),
      document('c', 'Шкала ABC'),
    ]);
    const fixture = cases.find((item) => item.normalizedQuery === 'шкала abc');
    expect(fixture?.expectedTop1DocumentIds).toEqual(['a', 'c']);
    expect(fixture?.exactSurfaceDocumentIds).toEqual(['a', 'b', 'c']);
  });

  it('gives exact titles stronger ground truth than declared aliases', () => {
    const cases = buildLookupQualityCases([
      document('title', 'Ясперс'),
      document('alias', 'Психопатология', ['Ясперс']),
    ]);
    const fixture = cases.find((item) => item.normalizedQuery === 'ясперс');
    expect(fixture?.expectedTop1DocumentIds).toEqual(['title']);
    expect(fixture?.exactSurfaceDocumentIds).toEqual(['alias', 'title']);
  });

  it('deduplicates repeated aliases and excludes unusably short surfaces', () => {
    const cases = buildLookupQualityCases([
      document('a', 'Клиническая шкала', ['ABC', 'ABC', 'С']),
    ]);
    expect(cases.some((item) => item.normalizedQuery === 'abc')).toBe(true);
    expect(cases.some((item) => item.normalizedQuery === 'с')).toBe(false);
  });
});
