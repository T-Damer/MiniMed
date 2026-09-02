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
  documentMatchesSearchScope,
  inferSearchScope,
  ScopedMedicalCore,
  searchResultDocumentKind,
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

  it('limits medication searches to installed medication documents', async () => {
    const base = coreWithDocuments(documents);
    const assistant = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, assistant.core, 'medications');

    await scoped.search(request());

    expect(base.search).toHaveBeenCalledOnce();
    expect(assistant.search).not.toHaveBeenCalled();
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      'mkb',
      'drug',
      'registry',
      'allmed',
    ]);
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
      const scoped = new ScopedMedicalCore(base.core, undefined, scope);

      await scoped.search(request());

      expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(expectedDocumentIds);
    }
  });

  it('keeps a trade-name pointer only when the alias and dose form occur in one result', async () => {
    const matching = pointerDocument('matching-pointer', 'medication', 'medication');
    const combination = pointerDocument('combination-pointer', 'medication', 'medication');
    const matchingResult = {
      ...searchResult(matching.id, 'Детская суспензия 100 мг/5 мл.'),
      matchedTerms: ['нурофен', 'суспензия', 'ибупрофен'],
    };
    const value = medicationAliasResponse({
      query: 'нурофен суспензия',
      alias: 'Нурофен',
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      matching.id,
    ]);
  });

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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
      queryRequest(value.analysis.originalQuery),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([pointer.id]);
  });

  it('does not filter direct MNN or context-free trade-name queries', async () => {
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
          groups: [searchGroup(direct.id, [searchResult(direct.id, 'Таблетки 200 мг.')])],
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
    const scoped = new ScopedMedicalCore(base.core, undefined, 'medications');

    const directResult = await scoped.search(queryRequest('ибупрофен мазь'));
    const tradeOnlyResult = await scoped.search(queryRequest('нурофен'));

    expect(directResult.ok && directResult.value.groups.map((group) => group.documentId)).toEqual([
      direct.id,
    ]);
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'medications').search(
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

    const result = await new ScopedMedicalCore(base.core, undefined, 'diagnosis').search(
      queryRequest('лихорадка у ребенка'),
    );

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      clinical.id,
      fullDocument.id,
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

    const allResult = await new ScopedMedicalCore(allBase.core, undefined, 'all').search(
      queryRequest('препарат'),
    );
    const medicationsResult = await new ScopedMedicalCore(
      medicationsBase.core,
      undefined,
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
    const scoped = new ScopedMedicalCore(base.core, undefined, 'medications');

    const result = await scoped.search(request());

    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual([
      'miramistin',
    ]);
  });

  it('intersects an existing document filter with the selected source family', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'guidelines');

    await scoped.search(request(['guideline-summary', 'drug']));

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['guideline-summary']);
  });

  it('includes medical references with recommendations and norms', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'guidelines');

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
    const scoped = new ScopedMedicalCore(
      base.core,
      undefined,
      'medications',
      new Set(['registry']),
    );

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
    const scoped = new ScopedMedicalCore(base.core, undefined, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      '__minimed_empty_search_scope__',
    ]);
  });

  it('returns no official documents for the personal scope', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'personal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      '__minimed_empty_search_scope__',
    ]);
  });

  it('includes regulatory source cards and full acts in legal search', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['law', 'law-summary']);
  });

  it('uses the grounded assistant only for diagnosis', async () => {
    const base = coreWithDocuments(documents);
    const assistant = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, assistant.core, 'diagnosis');

    await scoped.search(request());
    await scoped.analyzeQuery({ query: 'test', includeSuggestions: true });

    expect(assistant.search).toHaveBeenCalledOnce();
    expect(assistant.analyzeQuery).toHaveBeenCalledOnce();
    expect(base.search).not.toHaveBeenCalled();
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
