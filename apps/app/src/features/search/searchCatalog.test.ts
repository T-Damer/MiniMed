import { describe, expect, it } from 'vitest';
import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import {
  CUSTOM_CALCULATOR,
  CUSTOM_QUESTIONNAIRE,
  matchingCatalogTools,
  queryAsksForTool,
  searchCatalogSections,
  searchCatalogTools,
  toolsFollowResults,
} from './searchCatalog';

describe('official forms in a search (S2)', () => {
  it('finds a form by its number and opens the filling screen', () => {
    const tools = searchCatalogTools();
    for (const query of ['070/у', '070', 'форма 070/у', '070у']) {
      const forms = matchingCatalogTools(tools, 'all', undefined, query).filter((entry) =>
        entry.id.startsWith('ru.'),
      );
      expect(forms.map((entry) => entry.href)).toEqual(['#/notes/forms/ru.minzdrav.274n.070u']);
      expect(forms[0]?.title).toBe(
        'Форма № 070/у — Справка для получения путевки на санаторно-курортное лечение',
      );
    }
  });

  it('keeps forms out of the sections and of an empty query', () => {
    const tools = searchCatalogTools();
    expect(tools.some((entry) => entry.group === 'forms')).toBe(false);
    expect(
      matchingCatalogTools(tools, 'all', undefined, '').some((entry) => entry.group === 'forms'),
    ).toBe(false);
    expect(
      matchingCatalogTools(tools, 'calculators', undefined, '070').some(
        (entry) => entry.group === 'forms',
      ),
    ).toBe(false);
  });
});

describe('tools after the documents (S5)', () => {
  const tools = searchCatalogTools();
  const matches = (query: string) => matchingCatalogTools(tools, 'all', undefined, query);

  it('lets a bare disease name lead with its article, not with a scale that mentions it', () => {
    expect(queryAsksForTool('Депрессия')).toBe(false);
    expect(toolsFollowResults('Депрессия', matches('Депрессия'))).toBe(true);
  });

  it('keeps tools first when the query asks for one or names one', () => {
    expect(toolsFollowResults('шкала депрессии', matches('шкала депрессии'))).toBe(false);
    expect(toolsFollowResults('070/у', matches('070/у'))).toBe(false);
    expect(toolsFollowResults('шкала Апгар', matches('шкала Апгар'))).toBe(false);
    expect(toolsFollowResults('Апгар', matches('Апгар'))).toBe(false);
    expect(toolsFollowResults('', matches(''))).toBe(false);
  });
});

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
    expect(
      matchingCatalogTools(tools, 'calculators', undefined, 'создать свое').map(
        (entry) => entry.href,
      ),
    ).toEqual(['#/calculators/mine/new']);
  });
  it('offers the create-your-own calculator card in the calculators list and in a search', () => {
    const tools = searchCatalogTools();
    const calculators = matchingCatalogTools(tools, 'calculators', undefined, '');
    expect(calculators[0]).toBe(CUSTOM_CALCULATOR);
    expect(CUSTOM_CALCULATOR).toMatchObject({
      scope: 'calculators',
      title: 'Создать свой калькулятор',
      href: '#/calculators/mine/new',
      createsNew: true,
    });
    // No age filter hides an action card, and the questionnaire card stays out of this list.
    expect(matchingCatalogTools(tools, 'calculators', undefined, '', 'adults')[0]).toBe(
      CUSTOM_CALCULATOR,
    );
    expect(calculators).not.toContain(CUSTOM_QUESTIONNAIRE);
    expect(matchingCatalogTools(tools, 'assessments', undefined, '')).not.toContain(
      CUSTOM_CALCULATOR,
    );
    const searched = matchingCatalogTools(tools, 'all', undefined, 'создать свое');
    expect(searched).toEqual(expect.arrayContaining([CUSTOM_CALCULATOR, CUSTOM_QUESTIONNAIRE]));
    // Without a query the all-sources list stays a list of real tools.
    expect(matchingCatalogTools(tools, 'all', undefined, '')).not.toContain(CUSTOM_CALCULATOR);
    expect(matchingCatalogTools(tools, 'legal', undefined, '')).not.toContain(CUSTOM_CALCULATOR);
  });
  it('lists no tool for a clinical abbreviation that only occurs inside longer words', () => {
    const tools = searchCatalogTools();
    for (const abbreviation of ['АГ', 'ОКС', 'ХСН']) {
      expect(
        matchingCatalogTools(tools, 'all', undefined, abbreviation).map((entry) => entry.title),
      ).toEqual([]);
    }
    // A word start still finds a tool while the query is being typed.
    const scales = matchingCatalogTools(tools, 'all', undefined, 'шк').map((entry) => entry.title);
    expect(scales.length).toBeGreaterThan(0);
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

  it('counts only clinical recommendations in the «Клинические рекомендации» counter', () => {
    const base = {
      shortTitle: null,
      status: 'active' as const,
      specialties: ['pediatrics'],
      versionId: 'v1',
      versionLabel: '1',
      effectiveFrom: null,
    };
    const documents = [
      { ...base, id: 'kr.1', title: 'КР', sourceType: 'clinical_recommendation' },
      {
        ...base,
        id: 'pointer.kr.2',
        title: 'КР 2',
        sourceType: 'core_catalog_pointer',
        metadata: { catalogFamily: 'clinical' },
      },
      // Searched in the same section, but not a recommendation: an installed reference pack.
      { ...base, id: 'rls.1', title: 'МКБ', sourceType: 'rls_mkb_reference' },
      { ...base, id: 'ref.1', title: 'Справочник', sourceType: 'medical_reference' },
    ];
    const guidelines = searchCatalogSections(documents, []).find(
      (section) => section.id === 'guidelines',
    );
    expect(guidelines?.count).toBe(2);
  });
});
