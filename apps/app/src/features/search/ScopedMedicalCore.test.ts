import type {
  MedicalCore,
  MedicalDocumentSummary,
  QueryFact,
  QueryFactKind,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchResultGroup,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  inferSearchScope,
  preferClinicalRecommendationForCaseQueries,
  ScopedMedicalCore,
  searchResultDocumentKind,
  searchResultDocumentType,
} from '@/features/search/ScopedMedicalCore';

function document(id: string, sourceType: string): MedicalDocumentSummary {
  return {
    id,
    title: id,
    shortTitle: null,
    sourceType,
    status: 'active',
    specialties: [],
    versionId: `${id}.v1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

function pointerDocument(
  id: string,
  catalogFamily: string,
  entityType: string,
): MedicalDocumentSummary {
  return {
    ...document(id, 'core_catalog_pointer'),
    metadata: { contentMode: 'module-pointer', catalogFamily, entityType },
  };
}

function response(): SearchResponse {
  return {
    requestId: 'test',
    normalizedQuery: 'test',
    elapsedMs: 0,
    modeUsed: 'lexical',
    analysis: {
      originalQuery: 'test',
      normalizedQuery: 'test',
      facts: [],
      branches: [],
      suggestions: [],
      warnings: [],
    },
    suggestions: [],
    groups: [],
    diagnostics: {
      ftsQuery: 'test',
      candidateCount: 0,
      aliasMatches: [],
      terms: [],
      branches: [],
      semantic: {
        status: 'disabled',
        requestedMode: 'lexical',
        profileId: null,
        candidateCount: 0,
        elapsedMs: 0,
        fallbackReason: null,
      },
    },
  };
}

function medicationResponse(): SearchResponse {
  const base = response();
  return {
    ...base,
    analysis: {
      ...base.analysis,
      facts: [
        {
          id: 'medication:0',
          kind: 'medication',
          label: 'Препарат',
          value: 'Мирамистин',
          normalizedValue: 'мирамистин',
          unit: null,
          polarity: 'positive',
          range: { start: 0, end: 10 },
        },
      ],
    },
    groups: [
      {
        documentId: 'miramistin',
        title: 'Мирамистин 0,01%',
        bestScore: 1,
        categories: ['treatment'],
        results: [
          {
            chunkId: 'miramistin.chunk',
            documentId: 'miramistin',
            documentVersionId: 'miramistin.v1',
            sectionId: 'miramistin.section',
            anchor: 'indications',
            title: 'Мирамистин 0,01%',
            sectionPath: ['Показания'],
            snippet: 'Мирамистин применяется…',
            highlightedRanges: [],
            lexicalScore: 1,
            semanticScore: null,
            finalScore: 1,
            matchedTerms: ['мирамистин', 'показан'],
            matchedBranches: ['Клинические признаки'],
            sectionType: 'treatment',
            category: 'treatment',
          },
        ],
      },
      {
        documentId: 'paracetamol',
        title: 'Парацетамол',
        bestScore: 0.5,
        categories: ['treatment'],
        results: [
          {
            chunkId: 'paracetamol.chunk',
            documentId: 'paracetamol',
            documentVersionId: 'paracetamol.v1',
            sectionId: 'paracetamol.section',
            anchor: 'indications',
            title: 'Парацетамол',
            sectionPath: ['Показания'],
            snippet: 'Показания к применению…',
            highlightedRanges: [],
            lexicalScore: 0.5,
            semanticScore: null,
            finalScore: 0.5,
            matchedTerms: ['показан'],
            matchedBranches: ['Клинические признаки'],
            sectionType: 'treatment',
            category: 'treatment',
          },
        ],
      },
    ],
  };
}

function queryFact<Kind extends QueryFactKind>(
  kind: Kind,
  value: string,
  normalizedValue = value,
): QueryFact<Kind> {
  return {
    id: `${kind}:${value}`,
    kind,
    label: kind,
    value,
    normalizedValue,
    unit: null,
    polarity: 'positive',
    range: { start: 0, end: value.length },
  };
}

function searchResult(
  documentId: string,
  snippet: string,
  sectionPath: readonly string[] = ['Сведения о препарате'],
  title = sectionPath.at(-1) ?? 'Сведения о препарате',
): SearchResult {
  return {
    chunkId: `${documentId}.${snippet}`,
    documentId,
    documentVersionId: `${documentId}.v1`,
    sectionId: `${documentId}.section`,
    anchor: 'record',
    title,
    sectionPath,
    snippet,
    highlightedRanges: [],
    lexicalScore: 1,
    semanticScore: null,
    finalScore: 1,
    matchedTerms: ['ибупрофен'],
    matchedBranches: [],
    sectionType: 'treatment',
    category: 'treatment',
  };
}

function searchGroup(
  documentId: string,
  results: readonly SearchResult[],
  title = 'Ибупрофен',
): SearchResultGroup {
  return {
    documentId,
    title,
    bestScore: 1,
    categories: ['treatment'],
    results,
  };
}

interface MedicationAliasResponseOptions {
  readonly query: string;
  readonly alias: string;
  readonly canonical: string;
  readonly doseForm?: { readonly value: string; readonly normalizedValue?: string };
  readonly route?: { readonly value: string; readonly normalizedValue?: string };
  readonly strength?: { readonly value: string; readonly normalizedValue?: string };
  readonly age?: string;
  readonly weight?: string;
  readonly frequency?: string;
  readonly groups: readonly SearchResultGroup[];
}

function medicationAliasResponse(options: MedicationAliasResponseOptions): SearchResponse {
  const base = response();
  const medication = queryFact('medication', options.alias, options.canonical);
  const doseForm = options.doseForm
    ? [
        queryFact(
          'dose-form',
          options.doseForm.value,
          options.doseForm.normalizedValue ?? options.doseForm.value,
        ),
      ]
    : [];
  const route = options.route
    ? [
        queryFact(
          'route',
          options.route.value,
          options.route.normalizedValue ?? options.route.value,
        ),
      ]
    : [];
  const strength = options.strength
    ? [
        queryFact(
          'strength',
          options.strength.value,
          options.strength.normalizedValue ?? options.strength.value,
        ),
      ]
    : [];
  const age = options.age ? [queryFact('age', options.age)] : [];
  const weight = options.weight ? [queryFact('weight', options.weight)] : [];
  const frequency = options.frequency ? [queryFact('frequency', options.frequency)] : [];
  return {
    ...base,
    normalizedQuery: options.query,
    analysis: {
      ...base.analysis,
      originalQuery: options.query,
      normalizedQuery: options.query,
      facts: [medication],
      clinicalContext: {
        age,
        gestationalAge: [],
        sex: [],
        duration: [],
        weight,
        route,
        doseForm,
        strength,
        frequency,
        measurements: [],
        positiveFindings: [],
        negativeFindings: [],
        currentMedicines: [medication],
        pregnancy: [],
        organFunction: [],
        allergies: [],
      },
    },
    groups: options.groups,
  };
}

function queryRequest(query: string): SearchRequest {
  return { ...request(), query };
}

function request(documentIds?: readonly string[]): SearchRequest {
  return {
    query: 'test',
    mode: 'lexical',
    filters: documentIds ? { documentIds: [...documentIds] } : {},
    limit: 20,
    includeSuggestions: true,
  };
}

function coreWithDocuments(documents: readonly MedicalDocumentSummary[]) {
  const search = vi.fn(async (_request: SearchRequest) => ({
    ok: true as const,
    value: response(),
  }));
  const listDocuments = vi.fn(async () => ({ ok: true as const, value: documents }));
  const analyzeQuery = vi.fn(async () => ({
    ok: true as const,
    value: response().analysis,
  }));
  const ask = vi.fn(async () => ({ ok: true as const, value: { text: 'ok' } }));
  const core = {
    search,
    listDocuments,
    analyzeQuery,
    ask,
  } as unknown as MedicalCore;
  return { core, search, listDocuments, analyzeQuery, ask };
}

describe('ScopedMedicalCore', () => {
  it('uses compact search documents without loading the full catalog', async () => {
    const base = coreWithDocuments([]);
    const listSearchDocuments = vi.fn(async () => ({ ok: true as const, value: [] }));
    Object.assign(base.core, { listSearchDocuments });
    base.listDocuments.mockImplementation(async () => {
      throw new Error('Full catalog is not needed');
    });
    const result = await new ScopedMedicalCore(base.core, 'all').search(request());
    expect(result.ok).toBe(true);
    expect(listSearchDocuments).toHaveBeenCalledOnce();
    expect(base.listDocuments).not.toHaveBeenCalled();
    expect(base.search).toHaveBeenCalledOnce();
  });

  const documents = [
    document('guideline', 'clinical_recommendation'),
    document('guideline-summary', 'clinical_recommendation_summary'),
    document('reference', 'medical_reference'),
    document('mkb', 'rls_mkb_reference'),
    document('drug', 'official_drug_instruction'),
    document('registry', 'official_registry_summary'),
    document('allmed', 'allmed_reference'),
    document('law', 'regulatory_act'),
    document('law-summary', 'regulatory_act_summary'),
  ];

  it('limits conditions to ICD references and condition catalog entries', async () => {
    const base = coreWithDocuments([
      ...documents,
      pointerDocument('condition', 'reference', 'condition'),
      pointerDocument('symptom', 'reference', 'symptom'),
      pointerDocument('recommendation', 'clinical', 'disease'),
      pointerDocument('calculator', 'reference', 'calculator'),
    ]);
    await new ScopedMedicalCore(base.core, 'conditions').search(request());
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      'mkb',
      'condition',
      'symptom',
    ]);
  });

  it('distinguishes source pointers, summaries, and full documents in free search', async () => {
    const sources = [
      document('full', 'clinical_recommendation'),
      document('summary', 'clinical_recommendation_summary'),
      pointerDocument('pointer', 'clinical', 'disease'),
    ];
    const base = coreWithDocuments(sources);
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...response(),
        groups: sources.map((source) => searchGroup(source.id, [searchResult(source.id, 'Текст')])),
      },
    });
    const result = await new ScopedMedicalCore(base.core, 'all').search(request());
    expect(
      result.ok && result.value.groups.map((group) => [group.documentId, group.contentKind]),
    ).toEqual([
      ['full', 'full-text'],
      ['summary', 'summary'],
      ['pointer', 'pointer'],
    ]);
  });

  it('keeps an exact-title lookup above diagnosis source-type reranking', async () => {
    const exactTitle = 'D32.0 Оболочек головного мозга, МКБ-10';
    const exactReference = {
      ...document('exact-reference', 'medical_reference'),
      title: exactTitle,
      shortTitle: 'D32.0',
    };
    const clinicalDistractor = document('clinical-distractor', 'clinical_recommendation');
    const base = coreWithDocuments([exactReference, clinicalDistractor]);
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...response(),
        groups: [
          searchGroup(
            exactReference.id,
            [searchResult(exactReference.id, 'Точное справочное совпадение')],
            exactTitle,
          ),
          searchGroup(
            clinicalDistractor.id,
            [searchResult(clinicalDistractor.id, 'Клинический документ')],
            clinicalDistractor.title,
          ),
        ],
      },
    });

    const result = await new ScopedMedicalCore(base.core, 'diagnosis').search({
      ...request(),
      query: exactTitle,
      analysisMode: 'clinical',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups[0]?.documentId).toBe(exactReference.id);
  });

  it('limits medication searches to installed medication documents', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'medications');

    await scoped.search(request());

    expect(base.search).toHaveBeenCalledOnce();
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      'drug',
      'registry',
      'allmed',
    ]);
  });

  it('keeps tool documents out of the document sections', () => {
    const assessment = {
      sourceType: 'medical_reference',
      metadata: { interactiveAssessmentId: 'paei' },
    };
    const calculator = { sourceType: 'medical_reference', metadata: { calculationRequired: true } };
    expect(documentMatchesSearchScope(assessment, 'guidelines')).toBe(false);
    expect(documentMatchesSearchScope(assessment, 'assessments')).toBe(true);
    expect(documentMatchesSearchScope(assessment, 'all')).toBe(true);
    expect(documentMatchesSearchScope(calculator, 'guidelines')).toBe(false);
    expect(documentMatchesSearchScope(calculator, 'calculators')).toBe(true);
    expect(documentMatchesSearchScope({ sourceType: 'medical_reference' }, 'guidelines')).toBe(
      true,
    );
  });

  it('routes core catalog pointers by catalog family and entity type', () => {
    const medication = pointerDocument('medication-pointer', 'medication', 'medication');
    const clinicalDisease = pointerDocument('disease-pointer', 'clinical', 'disease');
    const clinicalReference = pointerDocument('reference-pointer', 'clinical', 'reference');
    const legal = pointerDocument('legal-pointer', 'legal', 'regulation');
    const unknown = pointerDocument('unknown-pointer', 'unknown', 'medication');

    expect(documentMatchesSearchScope(medication, 'medications')).toBe(true);
    expect(documentMatchesSearchScope(medication, 'guidelines')).toBe(false);
    expect(searchResultDocumentKind(medication)).toBe('medication');

    expect(documentMatchesSearchScope(clinicalDisease, 'guidelines')).toBe(true);
    expect(documentMatchesSearchScope(clinicalDisease, 'medications')).toBe(false);
    expect(searchResultDocumentKind(clinicalDisease)).toBe('clinical-recommendation');
    expect(searchResultDocumentKind(clinicalReference)).toBe('reference');

    expect(documentMatchesSearchScope(legal, 'legal')).toBe(true);
    expect(documentMatchesSearchScope(legal, 'guidelines')).toBe(false);
    expect(searchResultDocumentKind(legal)).toBe('legal');

    expect(documentMatchesSearchScope(unknown, 'medications')).toBe(false);
    expect(documentMatchesSearchScope(unknown, 'guidelines')).toBe(false);
    expect(documentMatchesSearchScope(unknown, 'legal')).toBe(false);
    expect(documentMatchesSearchScope(unknown, 'all')).toBe(true);
    expect(searchResultDocumentKind(unknown)).toBe('reference');
  });

  it('names what a source is in words a doctor knows', () => {
    const pointer = (extra: Record<string, unknown>): MedicalDocumentSummary => ({
      ...document('pointer', 'core_catalog_pointer'),
      metadata: { contentMode: 'module-pointer', ...extra },
    });
    const withMetadata = (
      sourceType: string,
      metadata: Record<string, unknown>,
    ): MedicalDocumentSummary => ({ ...document('doc', sourceType), metadata });

    expect(
      searchResultDocumentType(pointer({ catalogFamily: 'clinical', entityType: 'disease' })),
    ).toBe('clinical-recommendation');
    expect(searchResultDocumentType(pointer({ catalogFamily: 'medication' }))).toBe('medication');
    // An ICD-10 article from the RLS catalogue is an ICD-10 entry; a site article is a reference.
    expect(
      searchResultDocumentType(
        pointer({
          catalogFamily: 'reference',
          entityType: 'disease',
          sourceType: 'rls_mkb_reference',
        }),
      ),
    ).toBe('icd10');
    expect(
      searchResultDocumentType(
        pointer({
          catalogFamily: 'reference',
          entityType: 'disease',
          sourceType: 'krasotaimedicina_reference',
        }),
      ),
    ).toBe('reference');
    expect(searchResultDocumentType(document('order', 'regulatory_act_summary'))).toBe('legal');
    expect(
      searchResultDocumentType(withMetadata('regulatory_act_summary', { documentKind: 'приказ' })),
    ).toBe('order');
    expect(
      searchResultDocumentType(
        withMetadata('regulatory_act_summary', { documentKind: 'федеральный закон' }),
      ),
    ).toBe('law');
    expect(searchResultDocumentType(document('icd11', 'who_icd11_reference'))).toBe('icd11');
    expect(searchResultDocumentType(withMetadata('medical_reference', { terminology: {} }))).toBe(
      'definition',
    );
    expect(
      searchResultDocumentType(
        withMetadata('medical_reference', { interactiveAssessmentId: 'epds' }),
      ),
    ).toBe('assessment');
    expect(searchResultDocumentType(document('diet', 'medical_reference'))).toBe('reference');
  });

  it('filters core catalog pointers by family in scoped search', async () => {
    const pointers = [
      pointerDocument('medication-pointer', 'medication', 'medication'),
      pointerDocument('clinical-pointer', 'clinical', 'disease'),
      pointerDocument('legal-pointer', 'legal', 'regulation'),
      pointerDocument('unknown-pointer', 'unknown', 'reference'),
    ];

    for (const [scope, expectedDocumentIds] of [
      ['medications', ['medication-pointer']],
      ['guidelines', ['clinical-pointer']],
      ['legal', ['legal-pointer']],
    ] as const) {
      const base = coreWithDocuments(pointers);
      const scoped = new ScopedMedicalCore(base.core, scope);

      await scoped.search(request());

      expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(expectedDocumentIds);
    }
  });

  it.each(['Нурофен', 'ибупрофен'])(
    'keeps %s only when the name and dose form occur in one result',
    async (name) => {
      const matching = pointerDocument('matching-pointer', 'medication', 'medication');
      const combination = pointerDocument('combination-pointer', 'medication', 'medication');
      const matchingResult = {
        ...searchResult(matching.id, 'Детская суспензия 100 мг/5 мл.'),
        matchedTerms: ['нурофен', 'суспензия', 'ибупрофен'],
      };
      const value = medicationAliasResponse({
        query: `${name} суспензия`,
        alias: name,
        canonical: 'ибупрофен',
        doseForm: { value: 'суспензия' },
        groups: [
          searchGroup(matching.id, [matchingResult]),
          searchGroup(
            combination.id,
            [searchResult(combination.id, 'Ибупрофен + кодеин. Таблетки 200 мг + 12,8 мг.')],
            'Ибупрофен + кодеин',
          ),
        ],
      });
      const base = coreWithDocuments([matching, combination]);
      base.search.mockResolvedValueOnce({ ok: true, value });

      const result = await new ScopedMedicalCore(base.core, 'medications').search(
        queryRequest(value.analysis.originalQuery),
      );

      expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
        matching.id,
      ]);
    },
  );

  it('keeps only matching presentation sections and recalculates the group score', async () => {
    const pointer = pointerDocument('strength-pointer', 'medication', 'medication');
    const wrongSection = {
      ...searchResult(pointer.id, 'Нурофен для детей. Суппозитории ректальные (60 мг).', [
        'Указатель препарата',
        'СУППОЗИТОРИИ РЕКТАЛЬНЫЕ — 60 мг',
      ]),
      finalScore: 3,
    };
    const matchingSection = {
      ...searchResult(pointer.id, 'Нурофен для детей. Суспензия для приема внутрь (100 мг/5 мл).', [
        'Указатель препарата',
        'СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ — 20 мг/мл',
      ]),
      finalScore: 1,
    };
    const value = medicationAliasResponse({
      query: 'нурофен 100 мг/5 мл',
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      strength: { value: '100 мг/5 мл' },
      groups: [searchGroup(pointer.id, [wrongSection, matchingSection])],
    });
    const base = coreWithDocuments([pointer]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups).toHaveLength(1);
    const group = result.ok ? result.value.groups[0] : undefined;
    expect(group?.results).toHaveLength(1);
    expect(group?.results[0]?.sectionPath).toEqual([
      'Указатель препарата',
      'СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ — 20 мг/мл',
    ]);
    expect(group?.bestScore).toBe(1);
  });

  it('drops a pointer when the trade alias and requested form occur in different results', async () => {
    const pointer = pointerDocument('split-pointer', 'medication', 'medication');
    const value = medicationAliasResponse({
      query: 'нурофен мазь',
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      doseForm: { value: 'мазь' },
      groups: [
        searchGroup(pointer.id, [
          searchResult(pointer.id, 'Торговое наименование: Нурофен. Таблетки 200 мг.'),
          searchResult(pointer.id, 'Лекарственная форма: мазь.', ['Мазь']),
        ]),
      ],
    });
    const base = coreWithDocuments([pointer]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups).toEqual([]);
  });

  it.each(['сироп', 'спироп'])('accepts suspension for the %s form alias', async (form) => {
    const pointer = pointerDocument('liquid-pointer', 'medication', 'medication');
    const value = medicationAliasResponse({
      query: `нурофен ${form}`,
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      doseForm: { value: form, normalizedValue: 'сироп' },
      groups: [
        searchGroup(pointer.id, [
          searchResult(pointer.id, 'Нурофен для детей. Суспензия 100 мг/5 мл.'),
        ]),
      ],
    });
    const base = coreWithDocuments([pointer]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([pointer.id]);
  });

  it('matches route word forms and strength in the same result', async () => {
    const pointer = pointerDocument('route-pointer', 'medication', 'medication');
    const value = medicationAliasResponse({
      query: 'роцефин 1 г внутримышечно',
      alias: 'Роцефин',
      canonical: 'цефтриаксон',
      route: { value: 'внутримышечно' },
      strength: { value: '1 г' },
      groups: [
        searchGroup(
          pointer.id,
          [searchResult(pointer.id, 'Роцефин 1 г. Раствор для внутримышечного введения.')],
          'Цефтриаксон',
        ),
      ],
    });
    const base = coreWithDocuments([pointer]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([pointer.id]);
  });

  it('filters mismatched forms for direct MNN but preserves context-free trade-name queries', async () => {
    const direct = pointerDocument('direct-pointer', 'medication', 'medication');
    const tradeOnly = pointerDocument('trade-only-pointer', 'medication', 'medication');
    const base = coreWithDocuments([direct, tradeOnly]);
    base.search
      .mockResolvedValueOnce({
        ok: true,
        value: medicationAliasResponse({
          query: 'ибупрофен мазь',
          alias: 'ибупрофен',
          canonical: 'ибупрофен',
          doseForm: { value: 'мазь' },
          groups: [
            searchGroup(direct.id, [searchResult(direct.id, 'Ибупрофен. Таблетки 200 мг.')]),
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: medicationAliasResponse({
          query: 'нурофен',
          alias: 'Нурофен',
          canonical: 'ибупрофен',
          groups: [searchGroup(tradeOnly.id, [searchResult(tradeOnly.id, 'Ибупрофен.')])],
        }),
      });
    const scoped = new ScopedMedicalCore(base.core, 'medications');

    const directResult = await scoped.search(queryRequest('ибупрофен мазь'));
    const tradeOnlyResult = await scoped.search(queryRequest('нурофен'));

    expect(directResult.ok && directResult.value.groups.map((group) => group.documentId)).toEqual(
      [],
    );
    expect(
      tradeOnlyResult.ok && tradeOnlyResult.value.groups.map((group) => group.documentId),
    ).toEqual([tradeOnly.id]);
  });

  it('ignores age, weight, and frequency when checking same-result medication context', async () => {
    const pointer = pointerDocument('pediatric-pointer', 'medication', 'medication');
    const value = medicationAliasResponse({
      query: 'нурофен суспензия ребенку 4 года 20 кг',
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      doseForm: { value: 'суспензия' },
      age: '4 года',
      weight: '20 кг',
      frequency: '2 раза в день',
      groups: [
        searchGroup(pointer.id, [searchResult(pointer.id, 'Нурофен для детей. Суспензия.')]),
      ],
    });
    const base = coreWithDocuments([pointer]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([pointer.id]);
  });

  it('drops a built-in medication when a trade alias is paired with the wrong form', async () => {
    const registry = document('registry-document', 'official_registry_summary');
    const value = medicationAliasResponse({
      query: 'нурофен мазь',
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      doseForm: { value: 'мазь' },
      groups: [
        searchGroup(
          registry.id,
          [searchResult(registry.id, 'Детская суспензия 100 мг/5 мл.')],
          'Нурофен — детская суспензия 100 мг/5 мл',
        ),
      ],
    });
    const base = coreWithDocuments([registry]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups).toEqual([]);
  });

  it('keeps a built-in medication when brand and form co-locate in its title or result', async () => {
    const titleMatch = document('registry-title-match', 'official_registry_summary');
    const resultMatch = document('registry-result-match', 'official_registry_summary');
    const value = medicationAliasResponse({
      query: 'нурофен суспензия',
      alias: 'Нурофен',
      canonical: 'ибупрофен',
      doseForm: { value: 'суспензия' },
      groups: [
        searchGroup(
          titleMatch.id,
          [searchResult(titleMatch.id, 'Детская суспензия 100 мг/5 мл.')],
          'Нурофен для детей',
        ),
        searchGroup(
          resultMatch.id,
          [searchResult(resultMatch.id, 'Нурофен для детей. Суспензия 100 мг/5 мл.')],
          'Ибупрофен',
        ),
      ],
    });
    const base = coreWithDocuments([titleMatch, resultMatch]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      titleMatch.id,
      resultMatch.id,
    ]);
  });

  it('drops medication pointers from diagnosis results without medication intent', async () => {
    const medication = pointerDocument('vaccine-pointer', 'medication', 'medication');
    const registry = document('vaccine-registry', 'official_registry_summary');
    const clinical = pointerDocument('fever-pointer', 'clinical', 'disease');
    const fullDocument = document('fever-guideline', 'clinical_recommendation');
    const baseResponse = response();
    const value: SearchResponse = {
      ...baseResponse,
      analysis: {
        ...baseResponse.analysis,
        intent: {
          primary: 'diagnosis',
          secondary: [],
          confidence: 0.9,
          matchedSignals: [],
          needsClarification: false,
        },
        facts: [queryFact('symptom', 'лихорадка')],
      },
      groups: [
        searchGroup(medication.id, [searchResult(medication.id, 'Вакцина.')], 'Вакцина'),
        searchGroup(registry.id, [searchResult(registry.id, 'Вакцина.')], 'Вакцина'),
        searchGroup(clinical.id, [searchResult(clinical.id, 'Лихорадка у детей.')], 'Лихорадка'),
        searchGroup(
          fullDocument.id,
          [searchResult(fullDocument.id, 'Лихорадка у детей.')],
          'Лихорадка',
        ),
      ],
    };
    const base = coreWithDocuments([medication, registry, clinical, fullDocument]);
    base.search.mockResolvedValueOnce({ ok: true, value });

    const result = await new ScopedMedicalCore(base.core, 'diagnosis').search(
      queryRequest('лихорадка у ребенка'),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      clinical.id,
      fullDocument.id,
    ]);
  });

  it('keeps a medication named in an intent-free lookup query in free search', async () => {
    const named = pointerDocument('metformin-pointer', 'medication', 'medication');
    const mentioned = document('insulin-registry', 'official_registry_summary');
    const guideline = document('diabetes-guideline', 'clinical_recommendation');
    const baseResponse = response();
    const base = coreWithDocuments([named, mentioned, guideline]);
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...baseResponse,
        analysis: { ...baseResponse.analysis, originalQuery: 'метформин' },
        groups: [
          searchGroup(named.id, [searchResult(named.id, 'Метформин.')], 'МЕТФОРМИН'),
          searchGroup(mentioned.id, [searchResult(mentioned.id, 'С метформином.')], 'Инсулин'),
          searchGroup(guideline.id, [searchResult(guideline.id, 'Метформин.')], 'Диабет'),
        ],
      },
    });

    const result = await new ScopedMedicalCore(base.core, 'all').search(queryRequest('метформин'));

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      named.id,
      guideline.id,
    ]);
  });

  it('keeps medication pointers for medication intent and explicit medication scope', async () => {
    const medication = pointerDocument('medication-pointer', 'medication', 'medication');
    const baseResponse = response();
    const medicationIntentResponse: SearchResponse = {
      ...baseResponse,
      analysis: {
        ...baseResponse.analysis,
        intent: {
          primary: 'medication',
          secondary: [],
          confidence: 0.9,
          matchedSignals: [],
          needsClarification: false,
        },
      },
      groups: [searchGroup(medication.id, [searchResult(medication.id, 'Вакцина.')], 'Вакцина')],
    };
    const allBase = coreWithDocuments([medication]);
    allBase.search.mockResolvedValueOnce({ ok: true, value: medicationIntentResponse });
    const medicationsBase = coreWithDocuments([medication]);
    medicationsBase.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...baseResponse,
        groups: [searchGroup(medication.id, [searchResult(medication.id, 'Вакцина.')], 'Вакцина')],
      },
    });

    const allResult = await new ScopedMedicalCore(allBase.core, 'all').search(
      queryRequest('препарат'),
    );
    const medicationsResult = await new ScopedMedicalCore(
      medicationsBase.core,
      'medications',
    ).search(queryRequest('лихорадка'));

    expect(allResult.ok && allResult.value.groups.map((group) => group.documentId)).toEqual([
      medication.id,
    ]);
    expect(
      medicationsResult.ok && medicationsResult.value.groups.map((group) => group.documentId),
    ).toEqual([medication.id]);
  });

  it('drops generic medication documents when the query names a specific drug', async () => {
    const base = coreWithDocuments(documents);
    base.search.mockResolvedValueOnce({ ok: true, value: medicationResponse() });
    const scoped = new ScopedMedicalCore(base.core, 'medications');

    const result = await scoped.search(request());

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      'miramistin',
    ]);
  });

  it('intersects an existing document filter with the selected source family', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'guidelines');

    await scoped.search(request(['guideline-summary', 'drug']));

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['guideline-summary']);
  });

  it('includes medical references with recommendations and norms', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'guidelines');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      'guideline',
      'guideline-summary',
      'reference',
      'mkb',
    ]);
  });

  it('can constrain a medication page to its own database documents', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'medications', new Set(['registry']));

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['registry']);
  });

  it('uses an impossible document id when the selected family is not installed', async () => {
    const base = coreWithDocuments(
      documents.filter(
        (item) =>
          item.sourceType !== 'regulatory_act' && item.sourceType !== 'regulatory_act_summary',
      ),
    );
    const scoped = new ScopedMedicalCore(base.core, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      '__minimed_empty_search_scope__',
    ]);
  });

  it('returns no official documents for the personal scope', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'personal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      '__minimed_empty_search_scope__',
    ]);
  });

  it('includes regulatory source cards and full acts in legal search', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['law', 'law-summary']);
  });

  it('puts clinical recommendations before references for a clinical case', async () => {
    const clinical = document('clinical', 'clinical_recommendation');
    const reference = document('reference', 'medical_reference');
    const law = document('law', 'regulatory_act');
    const base = coreWithDocuments([clinical, reference, law]);
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...response(),
        groups: [
          searchGroup(law.id, [searchResult(law.id, 'Порядок оказания помощи.')]),
          searchGroup(reference.id, [searchResult(reference.id, 'Описание заболевания.')]),
          searchGroup(clinical.id, [searchResult(clinical.id, 'Клиническая рекомендация.')]),
        ],
      },
    });

    const result = await new ScopedMedicalCore(base.core, 'diagnosis').search(
      queryRequest('клинический случай'),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      clinical.id,
      reference.id,
      law.id,
    ]);
  });

  it('prefers a clinical recommendation over an ICD reference for an age/sex case query in free search, without moving a named medication out of its slot', async () => {
    const icd = document('icd', 'rls_mkb_reference');
    const drug = document('drug', 'official_drug_instruction');
    const kr = document('kr', 'clinical_recommendation');
    const base = coreWithDocuments([icd, drug, kr]);
    const query = 'мужчина 60 лет пневмония амоксициллин';
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...response(),
        analysis: { ...response().analysis, originalQuery: query, normalizedQuery: query },
        groups: [
          searchGroup(icd.id, [searchResult(icd.id, 'J18.9 Пневмония неуточненная.')]),
          searchGroup(
            drug.id,
            [searchResult(drug.id, 'Амоксициллин, инструкция.')],
            'Амоксициллин',
          ),
          searchGroup(
            kr.id,
            [searchResult(kr.id, 'Внебольничная пневмония у взрослых.')],
            'Внебольничная пневмония у взрослых',
          ),
        ],
      },
    });

    const result = await new ScopedMedicalCore(base.core, 'all').search(queryRequest(query));

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      kr.id,
      drug.id,
      icd.id,
    ]);
  });

  it('leaves group order untouched for a plain lookup without age/sex context', async () => {
    const icd = document('icd', 'rls_mkb_reference');
    const kr = document('kr', 'clinical_recommendation');
    const base = coreWithDocuments([icd, kr]);
    base.search.mockResolvedValueOnce({
      ok: true,
      value: {
        ...response(),
        groups: [
          searchGroup(icd.id, [searchResult(icd.id, 'J18.9 Пневмония неуточненная.')]),
          searchGroup(kr.id, [searchResult(kr.id, 'Внебольничная пневмония у взрослых.')]),
        ],
      },
    });

    const result = await new ScopedMedicalCore(base.core, 'all').search(
      queryRequest('пневмония неуточненная'),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      icd.id,
      kr.id,
    ]);
  });

  it('uses deterministic retrieval for diagnosis', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, 'diagnosis');

    await scoped.search(request());
    await scoped.analyzeQuery({ query: 'test', includeSuggestions: true });

    expect(base.search).toHaveBeenCalledOnce();
    expect(base.analyzeQuery).toHaveBeenCalledOnce();
  });
});

describe('inferSearchScope', () => {
  it('maps confident intents and leaves ambiguous requests for the user', () => {
    const intent = (
      primary: 'diagnosis' | 'medication' | 'administrative-reference' | 'treatment' | 'mixed',
      confidence = 0.8,
    ) => ({
      primary,
      secondary: [],
      confidence,
      matchedSignals: [],
      needsClarification: false,
    });

    expect(inferSearchScope(intent('diagnosis'))).toBe('diagnosis');
    expect(inferSearchScope(intent('medication'))).toBe('medications');
    expect(inferSearchScope(intent('administrative-reference'))).toBe('legal');
    expect(inferSearchScope(intent('treatment'))).toBe('guidelines');
    expect(inferSearchScope(intent('mixed'))).toBeUndefined();
    expect(inferSearchScope(intent('diagnosis', 0.4))).toBeUndefined();
  });
});

describe('preferClinicalRecommendationForCaseQueries', () => {
  function kindGroup(
    documentId: string,
    documentKind: NonNullable<SearchResultGroup['documentKind']>,
    bestScore: number,
  ): SearchResultGroup {
    return { documentId, title: documentId, bestScore, categories: [], results: [], documentKind };
  }

  it('moves clinical-recommendation kind ahead of reference kind, leaving every other kind in its own slot', () => {
    const groups = [
      kindGroup('icd-1', 'reference', 3),
      kindGroup('drug', 'medication', 2),
      kindGroup('icd-2', 'reference', 1.5),
      kindGroup('kr', 'clinical-recommendation', 1),
    ];

    expect(
      preferClinicalRecommendationForCaseQueries(groups).map((group) => group.documentId),
    ).toEqual(['kr', 'drug', 'icd-1', 'icd-2']);
  });

  describe('with the query (S4)', () => {
    const recommendation = (documentId: string, terms: readonly string[]): SearchResultGroup => ({
      ...kindGroup(documentId, 'clinical-recommendation', 1),
      results: [{ ...searchResult(documentId, 'Текст.'), matchedTerms: [...terms] }],
    });
    const order = (groups: readonly SearchResultGroup[], query: string) =>
      preferClinicalRecommendationForCaseQueries(groups, query).map((group) => group.documentId);

    it('lifts a recommendation that matched the subject word or only the МКБ label', () => {
      const groups = [
        kindGroup('Пневмония у детей', 'reference', 3),
        recommendation('Туберкулез у детей', ['пневмония', 'пневмон', 'детей']),
        recommendation('Кишечные инфекции', ['мкб', 'k59']),
      ];
      expect(order(groups, 'пневмония у детей')).toEqual([
        'Туберкулез у детей',
        'Кишечные инфекции',
        'Пневмония у детей',
      ]);
    });

    it('lifts one that matched a whole synonym of the subject («ангина» → острый тонзиллит)', () => {
      const groups = [
        kindGroup('Ангина у детей', 'reference', 3),
        recommendation('Острый тонзиллит', ['острый', 'остр', 'тонзиллит']),
      ];
      expect(order(groups, 'ангина у ребенка')).toEqual(['Острый тонзиллит', 'Ангина у детей']);
    });

    it('keeps one that matched a single word a synonym brought in its place', () => {
      const groups = [
        kindGroup('Пневмония у детей', 'reference', 3),
        recommendation('МАЖБП у детей', ['ассоциированная', 'ассоциированн', 'детей']),
      ];
      expect(order(groups, 'пневмония у детей')).toEqual(['Пневмония у детей', 'МАЖБП у детей']);
      expect(order(groups, 'ассоциированная болезнь у детей')).toEqual([
        'МАЖБП у детей',
        'Пневмония у детей',
      ]);
    });
  });

  it('is a no-op with fewer than two clinical-recommendation/reference groups', () => {
    const groups = [
      kindGroup('drug', 'medication', 2),
      kindGroup('kr', 'clinical-recommendation', 1),
    ];

    expect(preferClinicalRecommendationForCaseQueries(groups)).toEqual(groups);
  });
});

it('filters legacy full ICD documents by the same entity rules as source pointers', () => {
  const cough = { ...document('cough', 'rls_mkb_reference'), metadata: { mkbCode: 'R05' } };
  expect(documentMatchesConditionGroup(cough, 'kind:icd')).toBe(true);
  expect(documentMatchesConditionGroup(cough, 'kind:symptom')).toBe(true);
  expect(documentMatchesConditionGroup(cough, 'kind:condition')).toBe(false);
  const injury = { ...cough, metadata: { mkbCode: 'S00' } };
  expect(documentMatchesConditionGroup(injury, 'kind:condition')).toBe(true);
});

describe('WHO ICD-11 reference documents', () => {
  const icd11 = document('who.icd11.mms.257068234', 'who_icd11_reference');

  it('belong to the «Все» scope only, never to a clinical or ICD-10 section', () => {
    expect(documentMatchesSearchScope(icd11, 'all')).toBe(true);
    for (const scope of [
      'diagnosis',
      'guidelines',
      'medications',
      'legal',
      'conditions',
      'calculators',
      'assessments',
      'personal',
    ] as const) {
      expect(documentMatchesSearchScope(icd11, scope)).toBe(false);
    }
    expect(documentMatchesConditionGroup(icd11, 'kind:icd')).toBe(false);
    expect(documentMatchesConditionGroup(icd11, 'kind:disease')).toBe(false);
  });

  it('is searched in «Все» but dropped from the diagnosis scope that searches the whole core', async () => {
    const mkb = document('rls.mkb.node.a00', 'rls_mkb_reference');
    const value: SearchResponse = {
      ...response(),
      groups: [
        searchGroup(icd11.id, [searchResult(icd11.id, 'Код МКБ-11: 1A00.')], '1A00 Холера'),
        searchGroup(mkb.id, [searchResult(mkb.id, 'A00 Холера')], 'A00 Холера'),
      ],
    };
    const all = coreWithDocuments([icd11, mkb]);
    all.search.mockResolvedValueOnce({ ok: true, value });
    const diagnosis = coreWithDocuments([icd11, mkb]);
    diagnosis.search.mockResolvedValueOnce({ ok: true, value });

    const inAll = await new ScopedMedicalCore(all.core, 'all').search(request());
    const inDiagnosis = await new ScopedMedicalCore(diagnosis.core, 'diagnosis').search(request());

    expect(inAll.ok && inAll.value.groups.map((group) => group.documentId)).toEqual([
      icd11.id,
      mkb.id,
    ]);
    expect(inDiagnosis.ok && inDiagnosis.value.groups.map((group) => group.documentId)).toEqual([
      mkb.id,
    ]);
  });

  it('never enters the document filter of a scope with a source-type list', async () => {
    const mkb = document('rls.mkb.node.a00', 'rls_mkb_reference');
    const base = coreWithDocuments([icd11, mkb]);

    await new ScopedMedicalCore(base.core, 'conditions').search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([mkb.id]);
  });
});
