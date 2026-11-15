import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { audienceLabel, clusterResultGroups, conditionTitleKey } from './condition-clusters';

function group(
  documentId: string,
  title: string,
  documentKind: SearchResultGroup['documentKind'] = 'reference',
  extra: Partial<SearchResultGroup> = {},
): SearchResultGroup {
  return { documentId, title, documentKind, bestScore: 1, categories: [], results: [], ...extra };
}

describe('conditionTitleKey', () => {
  it('reads the name out of an МКБ card title', () => {
    expect(conditionTitleKey('K85 Острый панкреатит, МКБ-10')).toBe('острый панкреатит');
    expect(conditionTitleKey('G43.9 Мигрень неуточненная, МКБ-10')).toBe('мигрень неуточненная');
    expect(conditionTitleKey('Острый  Панкреатит')).toBe('острый панкреатит');
  });
});

describe('clusterResultGroups', () => {
  it('folds the sources of one name under the recommendation, wherever it was ranked', () => {
    const result = clusterResultGroups([
      group('kim', 'Острый панкреатит'),
      group('kr', 'Острый панкреатит', 'clinical-recommendation'),
      group('icd', 'K85 Острый панкреатит, МКБ-10'),
      group('child', 'Панкреатит у детей'),
    ]);
    expect(result.map((cluster) => cluster.lead.documentId)).toEqual(['kr', 'child']);
    expect(result[0]?.others.map((other) => other.documentId)).toEqual(['kim', 'icd']);
    expect(result[1]?.others).toEqual([]);
  });

  it('keeps two recommendations of one name together, the better-ranked first', () => {
    const result = clusterResultGroups([
      group('kr4', 'Мигрень', 'clinical-recommendation'),
      group('kr2', 'Мигрень', 'clinical-recommendation'),
      group('kim', 'Мигрень'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.lead.documentId).toBe('kr4');
    expect(result[0]?.others.map((other) => other.documentId)).toEqual(['kr2', 'kim']);
  });

  it('never folds drugs, tools, legal acts or a term found as a definition', () => {
    const result = clusterResultGroups([
      group('drug1', 'Амоксициллин', 'medication'),
      group('drug2', 'Амоксициллин', 'medication'),
      group('calc', 'Мигрень', 'calculator'),
      group('term', 'Мигрень', 'reference', { terminologyMatch: 'term' }),
      group('kim', 'Мигрень'),
    ]);
    expect(result.map((cluster) => cluster.lead.documentId)).toEqual([
      'drug1',
      'drug2',
      'calc',
      'term',
      'kim',
    ]);
    expect(result.every((cluster) => cluster.others.length === 0)).toBe(true);
  });
});

describe('one name, two audiences', () => {
  const audience = new Map([
    ['adults', 'взрослые'],
    ['children', 'дети'],
  ]);
  const audienceOf = (item: SearchResultGroup) => audience.get(item.documentId);

  it('keeps the recommendation for children apart from the one for adults', () => {
    const result = clusterResultGroups(
      [
        group('adults', 'Мигрень', 'clinical-recommendation'),
        group('children', 'Мигрень', 'clinical-recommendation'),
        group('kim', 'Мигрень'),
        group('icd', 'G43 Мигрень, МКБ-10'),
      ],
      audienceOf,
    );
    expect(result.map((cluster) => cluster.lead.documentId)).toEqual(['adults', 'children']);
    // The article and the МКБ card fold under the first card of the name.
    expect(result[0]?.others.map((other) => other.documentId)).toEqual(['kim', 'icd']);
    expect(result[1]?.others).toEqual([]);
  });

  it('still folds two recommendations for the same audience', () => {
    const result = clusterResultGroups(
      [
        group('adults', 'Мигрень', 'clinical-recommendation'),
        group('adults-2', 'Мигрень', 'clinical-recommendation'),
      ],
      (item) => (item.documentId.startsWith('adults') ? 'взрослые' : undefined),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.others.map((other) => other.documentId)).toEqual(['adults-2']);
  });

  it('lets a recommendation lead an article that was ranked first, whatever its audience', () => {
    const result = clusterResultGroups(
      [group('kim', 'Мигрень'), group('children', 'Мигрень', 'clinical-recommendation')],
      audienceOf,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.lead.documentId).toBe('children');
  });

  it('reads the audience from the age categories the source gives', () => {
    expect(audienceLabel({ ageCategories: ['Дети'] })).toBe('дети');
    expect(audienceLabel({ ageCategories: ['Дети', 'Взрослые'] })).toBe('взрослые и дети');
    expect(audienceLabel({ ageCategories: [] })).toBeUndefined();
    expect(audienceLabel(undefined)).toBeUndefined();
  });
});
