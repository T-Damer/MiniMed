import { describe, expect, it } from 'vitest';
import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { matchingCatalogTools, searchCatalogSections, searchCatalogTools } from './searchCatalog';

describe('unified tool catalog', () => {
  it('counts real tools and keeps the creation action searchable within subsections', () => {
    const tools = searchCatalogTools();
    const assessments = searchCatalogSections([], tools).find(
      (section) => section.id === 'assessments',
    );
    expect(assessments?.count).toBe(getAssessmentCatalog().length);
    expect(assessments?.groups.reduce((count, group) => count + group.count, 0)).toBe(
      assessments?.count,
    );
    const matches = matchingCatalogTools(tools, 'assessments', 'pediatrics', 'создать свое');
    expect(matches.map((entry) => entry.href)).toEqual(['#/assessments/mine/new']);
    expect(matchingCatalogTools(tools, 'calculators', undefined, 'создать свое')).toEqual([]);
  });
  it('combines document and tool counts and filters the same unified specialty', () => {
    const tools = searchCatalogTools();
    const document = {
      id: 'gynecology-source',
      title: 'Source',
      shortTitle: null,
      sourceType: 'clinical_recommendation',
      status: 'active' as const,
      specialties: ['gynecology', 'obstetrics'],
      versionId: 'v1',
      versionLabel: '1',
      effectiveFrom: null,
    };
    const all = searchCatalogSections([document], tools).find((section) => section.id === 'all');
    expect(all?.count).toBe(1 + tools.length);
    const specialtyTools = matchingCatalogTools(tools, 'all', 'gynecology', '');
    expect(specialtyTools.some((entry) => entry.scope === 'assessments')).toBe(true);
    expect(specialtyTools.some((entry) => entry.scope === 'calculators')).toBe(true);
    expect(all?.groups.find((group) => group.id === 'gynecology')).toMatchObject({
      documentCount: 1,
      kinds: expect.arrayContaining(['clinical-recommendation', 'assessment', 'calculator']),
    });
    expect(all?.groups.find((group) => group.id === 'anthropometry')).toMatchObject({
      documentCount: 0,
      kinds: ['calculator'],
    });
    expect(all?.groups.find((group) => group.id === 'gynecology')?.count).toBe(
      1 + specialtyTools.length,
    );
    expect(
      specialtyTools.every((entry) => ['obstetrics', 'gynecology'].includes(entry.group)),
    ).toBe(true);
    const queryTools = matchingCatalogTools(tools, 'all', undefined, 'Гинекология');
    expect(queryTools.filter((entry) => entry.scope === 'assessments')).toHaveLength(4);
    expect(
      queryTools.filter((entry) => entry.scope === 'calculators').length,
    ).toBeGreaterThanOrEqual(2);
    expect(matchingCatalogTools(tools, 'legal', undefined, 'Гинекология')).toEqual([]);
    expect(matchingCatalogTools(tools, 'all', undefined, 'несуществующийинструмент')).toEqual([]);
  });
  it('offers real entity filters in the conditions dropdown', () => {
    const docs = ['symptom', 'condition', 'syndrome', 'disease'].map((entityType) => ({
      id: entityType,
      title: entityType,
      shortTitle: null,
      sourceType: 'core_catalog_pointer',
      status: 'active' as const,
      specialties: [],
      versionId: 'v1',
      versionLabel: '1',
      effectiveFrom: null,
      metadata: {
        catalogFamily: 'reference',
        entityType,
        sourceType: entityType === 'syndrome' ? 'krasotaimedicina_reference' : 'rls_mkb_reference',
      },
    }));
    const conditions = searchCatalogSections(docs, []).find(
      (section) => section.id === 'conditions',
    );
    expect(conditions?.count).toBe(4);
    expect(conditions?.groups.map(({ id, count }) => [id, count])).toEqual([
      ['kind:icd', 3],
      ['kind:symptom', 1],
      ['kind:condition', 1],
      ['kind:syndrome', 1],
      ['kind:disease', 1],
    ]);
  });
});
