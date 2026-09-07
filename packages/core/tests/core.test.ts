import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { PORTABLE_HASH_PROFILE, PortableHashEmbedder } from '@localmed/search-semantic';
import { InMemoryMedicalStore } from '@localmed/storage';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMedicalCore, requestedSectionType } from '../src/create-medical-core';

import { createInMemoryMedicalCore } from '../src/index';

const cores: ReturnType<typeof createInMemoryMedicalCore>[] = [];

const MIRAMISTIN_MNN = 'БЕНЗИЛДИМЕТИЛ-МИРИСТОИЛАМИНО-ПРОПИЛАММОНИЙ';

function medicationSearchDocument(
  id: string,
  title: string,
  text: string,
  additionalTexts: readonly string[] = [],
) {
  const chunkTexts = [text, ...additionalTexts];
  return {
    id,
    title,
    shortTitle: title,
    sourceType: 'official_registry_summary',
    status: 'active',
    specialties: ['pharmacology'],
    metadata: { catalogFamily: 'medication', contentMode: 'esklp-mnn' },
    version: {
      id: `${id}.v1`,
      label: '2026-08-28',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `checksum:${id}`,
      extractedAt: '2026-08-28T00:00:00Z',
    },
    sections: [
      {
        id: `${id}.registration`,
        parentSectionId: null,
        title: 'Регистрационные сведения',
        normalizedTitle: 'регистрационные сведения',
        sectionType: 'definition',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'registration',
        sectionPath: ['Регистрационные сведения'],
        chunks: chunkTexts.map((chunkText, index) => ({
          id: `${id}.registration.${index + 1}`,
          orderIndex: index,
          originalText: chunkText,
          normalizedText: normalizeForIndex(chunkText),
          pageStart: null,
          pageEnd: null,
          charStart: null,
          charEnd: null,
          anchor: `registration-${index + 1}`,
          metadata: {},
        })),
      },
    ],
  };
}

const MEDICATION_SEARCH_PACK = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.medication-search',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Medication search fixture',
    checksum: 'test-medication-search-checksum',
    builtAt: '2026-08-28T00:00:00Z',
  },
  documents: [
    medicationSearchDocument(
      'med.miramistin',
      MIRAMISTIN_MNN,
      `${MIRAMISTIN_MNN}. Торговое наименование: Мирамистин. Лекарственная форма: мазь.`,
    ),
    medicationSearchDocument(
      'med.ichthyol-ointment',
      'Ихтиоловая мазь',
      'Ихтиоловая мазь. Лекарственная форма: мазь.',
    ),
    medicationSearchDocument(
      'med.omeprazole-capsule',
      'Омепразол капсулы',
      'Омепразол. Лекарственная форма: капсулы.',
    ),
    medicationSearchDocument(
      'med.ibuprofen',
      'ИБУПРОФЕН',
      'ИБУПРОФЕН. ТН: Нурофен Экспресс. Лекарственная форма: гель.',
      [
        'ИБУПРОФЕН. Лекарственная форма: капсулы.',
        `${'ИБУПРОФЕН. ТН: Нурофен форте. Лекарственная форма: гель. '.repeat(8)}ИБУПРОФЕН. - ТН: Нурофен. ТАБЛЕТКИ 200.0 мг.`,
        'ИБУПРОФЕН. Торговое наименование: Нурофен для детей. СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ (100 мг/5 мл).',
      ],
    ),
    medicationSearchDocument(
      'med.ibuprofen-paracetamol',
      'ИБУПРОФЕН+ПАРАЦЕТАМОЛ',
      'ИБУПРОФЕН+ПАРАЦЕТАМОЛ. Торговое наименование: Нурофен Лонг.',
    ),
    medicationSearchDocument(
      'med.ibuprofen-codeine',
      'ИБУПРОФЕН+КОДЕИН',
      'ИБУПРОФЕН+КОДЕИН. Торговое наименование: Нурофен плюс.',
    ),
  ],
  aliases: [
    {
      id: 'alias.miramistin',
      canonicalTerm: MIRAMISTIN_MNN,
      alias: 'Мирамистин',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.miramistin.ointment',
      canonicalTerm: MIRAMISTIN_MNN,
      alias: 'Мирамистин мазь',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.ichthyol.ointment',
      canonicalTerm: 'Ихтиоловая мазь',
      alias: 'Ихтиоловая мазь',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.nurofen',
      canonicalTerm: 'ИБУПРОФЕН',
      alias: 'Нурофен',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.nurofen.children',
      canonicalTerm: 'ИБУПРОФЕН',
      alias: 'Нурофен для детей',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.nurofen.suspension',
      canonicalTerm: 'ИБУПРОФЕН',
      alias: 'Нурофен СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.nurofen.long',
      canonicalTerm: 'ИБУПРОФЕН+ПАРАЦЕТАМОЛ',
      alias: 'Нурофен Лонг',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.nurofen.plus',
      canonicalTerm: 'ИБУПРОФЕН+КОДЕИН',
      alias: 'Нурофен плюс',
      category: 'medication',
      weight: 1,
    },
  ],
});

const COMPONENT_ALIAS_CASES = [
  {
    id: 'paracetamol',
    query: 'парацетамол',
    canonical: 'ПАРАЦЕТАМОЛ',
    combination: 'ПАРАЦЕТАМОЛ+ИБУПРОФЕН',
    combinationOnlyTerm: 'ибупрофен',
  },
  {
    id: 'salbutamol',
    query: 'сальбутамол',
    canonical: 'САЛЬБУТАМОЛ',
    combination: 'САЛЬБУТАМОЛ+ИПРАТРОПИЯ БРОМИД',
    combinationOnlyTerm: 'ипратропия',
  },
  {
    id: 'erythromycin',
    query: 'эритромицин',
    canonical: 'ЭРИТРОМИЦИН',
    combination: 'ЦИНКА АЦЕТАТ+ЭРИТРОМИЦИН',
    combinationOnlyTerm: 'цинк',
  },
  {
    id: 'ceftriaxone',
    query: 'цефтриаксон',
    canonical: 'ЦЕФТРИАКСОН',
    combination: 'ЦЕФТРИАКСОН+СУЛЬБАКТАМ',
    combinationOnlyTerm: 'сульбактам',
  },
  {
    id: 'cefepime',
    query: 'цефепим',
    canonical: 'ЦЕФЕПИМ',
    combination: 'ЦЕФЕПИМ+СУЛЬБАКТАМ',
    combinationOnlyTerm: 'сульбактам',
  },
  {
    id: 'cefepime-typo',
    query: 'цефипим',
    canonical: 'ЦЕФЕПИМ',
    combination: 'ЦЕФЕПИМ+СУЛЬБАКТАМ',
    combinationOnlyTerm: 'сульбактам',
  },
] as const;

const COMPONENT_ALIAS_SEARCH_PACK = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.component-alias-search',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Component alias search fixture',
    checksum: 'test-component-alias-search-checksum',
    builtAt: '2026-08-28T00:00:00Z',
  },
  documents: COMPONENT_ALIAS_CASES.flatMap(({ id, canonical, combination }) => {
    const directDocument =
      id === 'salbutamol'
        ? medicationSearchDocument(
            `med.component.${id}.direct`,
            canonical,
            '<details data-medication="САЛЬБУТАМОЛ АЭРОЗОЛЬ"><summary></summary></details>',
            [
              '<details data-medication="САЛЬБУТАМОЛ АЭРОЗОЛЬ"><summary>Сведения</summary></details>',
              'САЛЬБУТАМОЛ. Лекарственная форма: аэрозоль для ингаляций дозированный.',
            ],
          )
        : id === 'ceftriaxone'
          ? medicationSearchDocument(
              `med.component.${id}.direct`,
              canonical,
              `${canonical}. Лекарственная форма: порошок для приготовления раствора для внутримышечного введения.`,
              [
                `${canonical}. Лекарственная форма: порошок для приготовления раствора для внутривенного введения.`,
              ],
            )
          : medicationSearchDocument(`med.component.${id}.direct`, canonical, `${canonical}.`);
    const combinationDocument =
      id === 'ceftriaxone'
        ? medicationSearchDocument(
            `med.component.${id}.combination`,
            combination,
            `${combination}. Лекарственная форма: порошок для приготовления раствора для внутривенного и внутримышечного введения. `.repeat(
              8,
            ),
            [
              `${combination}. Лекарственная форма: порошок для приготовления раствора для внутривенного введения.`,
            ],
          )
        : medicationSearchDocument(
            `med.component.${id}.combination`,
            combination,
            `${combination}.`,
          );
    return id === 'ceftriaxone'
      ? [combinationDocument, directDocument]
      : [directDocument, combinationDocument];
  }),
  aliases: COMPONENT_ALIAS_CASES.flatMap(({ id, canonical, combination }) => {
    const suffixAlias =
      id === 'paracetamol' || id === 'salbutamol'
        ? [
            {
              id: `alias.component.${id}.suffix`,
              canonicalTerm: combination,
              alias: `Препарат ${canonical}`,
              category: 'medication',
              weight: 1,
            },
          ]
        : [];
    return [
      {
        id: `alias.component.${id}.direct`,
        canonicalTerm: canonical,
        alias: canonical,
        category: 'medication',
        weight: 1,
      },
      {
        id: `alias.component.${id}.combination`,
        canonicalTerm: combination,
        alias: canonical,
        category: 'medication',
        weight: 1,
      },
      ...suffixAlias,
    ];
  }),
});

const TURBUHALER_SEARCH_PACK = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.turbuhaler-search',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Turbuhaler search fixture',
    checksum: 'test-turbuhaler-search-checksum',
    builtAt: '2026-08-28T00:00:00Z',
  },
  documents: [
    medicationSearchDocument(
      'med.turbuhaler.budesonide',
      'БУДЕСОНИД',
      'БУДЕСОНИД. Торговое наименование: Пульмикорт Турбухалер.',
    ),
    medicationSearchDocument(
      'med.turbuhaler.budesonide-formoterol',
      'БУДЕСОНИД+ФОРМОТЕРОЛ',
      'БУДЕСОНИД+ФОРМОТЕРОЛ.',
      [
        'БУДЕСОНИД+ФОРМОТЕРОЛ. Регистрационная запись 2.',
        'БУДЕСОНИД+ФОРМОТЕРОЛ. Регистрационная запись 3.',
        'БУДЕСОНИД+ФОРМОТЕРОЛ. Регистрационная запись 4.',
        'БУДЕСОНИД+ФОРМОТЕРОЛ. Торговое наименование: Симбикорт Турбухалер.',
        'БУДЕСОНИД+ФОРМОТЕРОЛ. Регистрационная запись 6.',
      ],
    ),
    medicationSearchDocument(
      'med.turbuhaler.formoterol',
      'ФОРМОТЕРОЛ',
      [
        '- ТН: Астманон. Регистрация: ЛП-005716. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00068-0000000000000. Лекарственная форма: АЭРОЗОЛЬ ДЛЯ МЕСТНОГО ПРИМЕНЕНИЯ ДОЗИРОВАННЫЙ. Дозировка/концентрация: 1.0 0.012 мг/доза. Единица: доз(а). Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: АЭРОЗОЛЬ ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ (12 мкг/доза).',
        '- ТН: Формотерол-Алиум. Регистрация: ЛП-005716. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00068-0000000000000. Лекарственная форма: АЭРОЗОЛЬ ДЛЯ МЕСТНОГО ПРИМЕНЕНИЯ ДОЗИРОВАННЫЙ. Дозировка/концентрация: 1.0 0.012 мг/доза. Единица: доз(а). Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: АЭРОЗОЛЬ ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ (12 мкг/доза).',
        '- ТН: Формотерол Эйр. Регистрация: ЛП-006286. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00068-0000000000000. Лекарственная форма: АЭРОЗОЛЬ ДЛЯ МЕСТНОГО ПРИМЕНЕНИЯ ДОЗИРОВАННЫЙ. Дозировка/концентрация: 1.0 0.012 мг/доза. Единица: доз(а). Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: АЭРОЗОЛЬ ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ (12 мкг/доза).',
        '- ТН: Форалес. Регистрация: ЛП-008162. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00137-0000000000000. Лекарственная форма: КАПСУЛЫ С ПОРОШКОМ ДЛЯ ИНГАЛЯЦИЙ. Дозировка/концентрация: 1.0 0.012 мг/доза. Единица: шт.. Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: КАПСУЛЫ С ПОРОШКОМ ДЛЯ ИНГАЛЯЦИЙ (12 мкг).',
        '- ТН: Формотерол ПСК. Регистрация: ЛП-008126. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00137-0000000000000. Лекарственная форма: КАПСУЛЫ С ПОРОШКОМ ДЛЯ ИНГАЛЯЦИЙ. Дозировка/концентрация: 1.0 0.012 мг/доза. Единица: шт.. Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: КАПСУЛЫ С ПОРОШКОМ ДЛЯ ИНГАЛЯЦИЙ (12 мкг).',
        '- ТН: Оксис Турбухалер. Регистрация: П N013937/01. СМНН: ФОРМОТЕРОЛ; smnnCode: 21.20.10.254-000010-1-00130-0000000000000. Лекарственная форма: ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ. Дозировка/концентрация: 1.0 0.0045 мг/доза. Единица: доз(а). Нормализованные МНН: ФОРМОТЕРОЛ. Нормализованные формы/дозировки: ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ (4.5 мкг/доза).',
      ].join('\n'),
    ),
    medicationSearchDocument(
      'med.turbuhaler.budesonide-salbutamol',
      'БУДЕСОНИД+САЛЬБУТАМОЛ',
      'БУДЕСОНИД+САЛЬБУТАМОЛ.',
    ),
    medicationSearchDocument('med.turbuhaler.unrelated', 'ПАРАЦЕТАМОЛ', 'ПАРАЦЕТАМОЛ.'),
  ],
  aliases: [
    {
      id: 'alias.pulmicort.turbuhaler',
      canonicalTerm: 'БУДЕСОНИД',
      alias: 'Пульмикорт Турбухалер',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.symbicort.turbuhaler',
      canonicalTerm: 'БУДЕСОНИД+ФОРМОТЕРОЛ',
      alias: 'Симбикорт Турбухалер',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.oxis.turbuhaler',
      canonicalTerm: 'ФОРМОТЕРОЛ',
      alias: 'Оксис Турбухалер',
      category: 'medication',
      weight: 1,
    },
  ],
});

const FORM_EQUIVALENCE_SEARCH_PACK = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.form-equivalence-search',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Medication form equivalence search fixture',
    checksum: 'test-form-equivalence-search-checksum',
    builtAt: '2026-08-28T00:00:00Z',
  },
  documents: [
    medicationSearchDocument(
      'med.form.suspension-only',
      'ФАРМАКСИН',
      'ФАРМАКСИН. Торговое наименование: Детский Фармокс. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ (100 мг/5 мл).',
    ),
    medicationSearchDocument(
      'med.form.syrup-only',
      'ЭКСПЕКТОРИН',
      'ЭКСПЕКТОРИН. Торговое наименование: Кашлестоп Плюс. Лекарственная форма: СИРОП.',
    ),
    medicationSearchDocument(
      'med.form.both',
      'ФОРМОРИН',
      'ФОРМОРИН. Торговое наименование: Форморин. Лекарственная форма: СИРОП.',
      [
        'ФОРМОРИН. Торговое наименование: Форморин. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ.',
      ],
    ),
    medicationSearchDocument(
      'med.form.direct-mnn',
      'ТЕСТПАРАЦЕТАМОЛ',
      'ТЕСТПАРАЦЕТАМОЛ. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ.',
    ),
    medicationSearchDocument(
      'med.form.combination',
      'ТЕСТПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ХЛОРФЕНАМИН',
      'ТЕСТПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ХЛОРФЕНАМИН. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ.',
    ),
    medicationSearchDocument(
      'med.form.injection-suspension',
      'ИНЪЕКТОРИН',
      'ИНЪЕКТОРИН. Торговое наименование: Инъектол. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ИНЪЕКЦИЙ.',
    ),
    medicationSearchDocument(
      'med.form.external-suspension',
      'НАРУЖОРИН',
      'НАРУЖОРИН. Торговое наименование: Наружол. Лекарственная форма: СУСПЕНЗИЯ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ.',
    ),
  ],
  aliases: [
    {
      id: 'alias.form.suspension-only',
      canonicalTerm: 'ФАРМАКСИН',
      alias: 'Детский Фармокс',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.form.syrup-only',
      canonicalTerm: 'ЭКСПЕКТОРИН',
      alias: 'Кашлестоп Плюс',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.form.both',
      canonicalTerm: 'ФОРМОРИН',
      alias: 'Форморин',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.form.injection-suspension',
      canonicalTerm: 'ИНЪЕКТОРИН',
      alias: 'Инъектол',
      category: 'medication',
      weight: 1,
    },
    {
      id: 'alias.form.external-suspension',
      canonicalTerm: 'НАРУЖОРИН',
      alias: 'Наружол',
      category: 'medication',
      weight: 1,
    },
  ],
});

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

describe('MedicalCore', () => {
  it('does not treat an inflected component of a vaccine name as a medicine', async () => {
    const core = createInMemoryMedicalCore({
      ...DEMO_CONTENT_PACK,
      aliases: [
        {
          id: 'vaccine-component',
          alias: 'ИНФЕКЦИИ',
          canonicalTerm: 'ВАКЦИНА ДЛЯ ПРОФИЛАКТИКИ ДИФТЕРИИ И ИНФЕКЦИЙ',
          category: 'medication',
          weight: 1,
        },
      ],
    });
    cores.push(core);
    const response = await core.analyzeQuery({
      query: 'апноэ у грудного ребенка на фоне вирусной инфекции',
      includeSuggestions: false,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.facts.some((fact) => fact.kind === 'medication')).toBe(false);
    expect(response.value.branches.flatMap((branch) => branch.terms)).not.toContain('вакцина');
  });

  it('does not interpret a one-letter virus type or preposition as a medication alias', async () => {
    const core = createInMemoryMedicalCore({
      ...DEMO_CONTENT_PACK,
      aliases: [
        ...DEMO_CONTENT_PACK.aliases,
        {
          id: 'invalid-single-letter',
          alias: 'С',
          canonicalTerm: 'Вакцина',
          category: 'medication',
          weight: 1,
        },
      ],
    });
    cores.push(core);
    const response = await core.analyzeQuery({
      query: 'острый гепатит С',
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.facts.some((fact) => fact.kind === 'medication')).toBe(false);
    expect(response.value.branches.flatMap((branch) => branch.terms)).not.toContain('вакцина');
  });
  it('recognizes medication indication requests as treatment lookups', () => {
    expect(requestedSectionType('мирамистин показания')).toBe('treatment');
  });

  it('initializes a portable core contract', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const status = await core.initialize();
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.value.documentCount).toBe(3);
  });

  it('searches through the ranking projection without loading full document metadata', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: DEMO_CONTENT_PACK, platform: 'test' });
    cores.push(core);
    const request = { query: 'пневмония', mode: 'lexical' as const, limit: 20 };
    const baseline = await core.search(request);
    const documents = await store.listDocuments();
    const listSearchDocuments = vi.fn(async () =>
      documents.map(({ id, sourceType, metadata }) => ({
        id,
        sourceType,
        metadata,
      })),
    );
    Object.assign(store, { listSearchDocuments });
    const listDocuments = vi
      .spyOn(store, 'listDocuments')
      .mockRejectedValue(new Error('Full catalog should not be read'));

    const compact = await core.listSearchDocuments?.();
    expect(compact?.ok).toBe(true);
    const result = await core.search(request);

    expect(result.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (result.ok && baseline.ok) {
      expect(result.value.groups.length).toBeGreaterThan(0);
      expect(result.value.groups).toEqual(baseline.value.groups);
    }
    expect(listSearchDocuments).toHaveBeenCalledTimes(2);
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('shares concurrent document-list reads', async () => {
    const store = new InMemoryMedicalStore();
    const listDocuments = vi.spyOn(store, 'listDocuments');
    const core = createMedicalCore({ store, seed: DEMO_CONTENT_PACK, platform: 'test' });
    cores.push(core);

    const results = await Promise.all([core.listDocuments(), core.listDocuments()]);

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    if (results[0]?.ok) expect(results[0].value[0]?.metadata).toBeDefined();
    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  it('reports the selected storage backend through core capabilities', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const capabilities = await core.getCapabilities();
    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    expect(capabilities.value).toMatchObject({
      storageBackend: 'in-memory',
      persistentStorage: false,
      storageInstallation: 'memory',
      storageSizeBytes: null,
    });
  });

  it('reports direct-only search execution when the option is set', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: DEMO_CONTENT_PACK,
      platform: 'test',
      searchExecution: 'direct-only',
    });
    cores.push(core);
    const capabilities = await core.getCapabilities();
    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    expect(capabilities.value.searchExecution).toBe('direct-only');
  });

  it('keeps a blood-pressure reading atomic in a medication query', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);

    const response = await core.search({
      query: 'Препарат взрослому при давлении 200/120',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.analysis.intent?.primary).toBe('medication');
    expect(response.value.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'measurement',
          label: 'АД',
          normalizedValue: '200/120',
        }),
      ]),
    );
    const terms = [
      ...response.value.diagnostics.terms,
      ...response.value.analysis.branches.flatMap((branch) => branch.terms),
    ];
    expect(terms).not.toEqual(expect.arrayContaining(['200', '120']));
    expect(response.value.diagnostics.ftsQuery).not.toMatch(/"(?:200|120)"\*/u);
  });

  it('extracts pediatric age and a positive rhinitis symptom from a medication query', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);

    const response = await core.search({
      query: 'Капли в нос ребенку 6 месяцев при насморке',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.analysis.intent?.primary).toBe('medication');
    expect(response.value.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'age', normalizedValue: '6 месяцев' }),
        expect.objectContaining({
          kind: 'symptom',
          label: 'Насморк',
          polarity: 'positive',
        }),
      ]),
    );
  });

  it('extracts pediatric age and a positive sore-throat symptom from a treatment query', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);

    const response = await core.search({
      query: 'Лечение боли в горле ребенку 6 лет',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.analysis.intent?.primary).toBe('treatment');
    expect(response.value.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'age', normalizedValue: '6 лет' }),
        expect.objectContaining({
          kind: 'symptom',
          label: 'Боль в горле',
          polarity: 'positive',
        }),
      ]),
    );
  });

  it('classifies an age-qualified antipyretic request as medication', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);

    const response = await core.search({
      query: 'Жаропонижающее ребенку 4 лет',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.analysis.intent?.primary).toBe('medication');
    expect(response.value.analysis.facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'age', normalizedValue: '4 лет' })]),
    );
  });

  it('expands colloquial terms and keeps the pneumonia section first in hybrid search', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Ребёнок часто дышит и температурит второй день',
      mode: 'auto',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.modeUsed).toBe('hybrid');
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
    expect(response.value.diagnostics.aliasMatches).toContain('часто дышит → тахипноэ');
  });

  it('analyzes a case without invoking a generative model', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.analyzeQuery({
      query: 'Девочка 8 лет, температура 39 второй день, часто дышит. Кашля нет.',
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['sex', 'age', 'temperature', 'duration', 'negative-finding']),
    );
    expect(response.value.branches.length).toBeGreaterThan(0);
  });

  it('fuses several lexical branches and explains the match', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Мальчик 5 лет. Лихорадка 39 второй день, часто дышит. Сатурация 94%.',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.diagnostics.branches.length).toBeGreaterThan(1);
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
    expect(response.value.groups[0]?.results[0]?.matchedBranches.length).toBeGreaterThan(0);
    expect(response.value.groups[0]?.results[0]?.category).toBe('clinical-picture');
  });

  it('keeps a strong clinical match above weak cross-branch overlap', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query:
        'Девочка 9 лет. Боль началась вчера около пупка, затем сместилась справа внизу живота. Дважды была рвота. ОАК: лейкоцитоз.',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.surgery.appendicitis');
    expect(response.value.groups[0]?.results[0]?.matchedBranches.length).toBeGreaterThan(0);
  });

  it('prefers the explicitly requested diagnostics section', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Диагностика аппендицита: локальная боль и рвота требуют другого поиска',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.surgery.appendicitis');
    expect(response.value.groups[0]?.results[0]?.sectionType).toBe('diagnostics');
  });

  it('prefers the routing section for an explicit hospitalization request', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Пневмония с дыхательной недостаточностью: нужна экстренная госпитализация',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
    expect(response.value.groups[0]?.results[0]?.sectionType).toBe('routing');
  });

  it('returns a stable context window around a search result', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'справа внизу живота рвота',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    const chunkId = response.value.groups[0]?.results[0]?.chunkId;
    if (!chunkId) throw new Error('Expected a search hit.');
    const context = await core.getContext(chunkId, 1);
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.value.focusChunkId).toBe(chunkId);
      expect(context.value.chunks.length).toBeGreaterThan(0);
    }
  });

  it('uses compatible local vectors for automatic hybrid retrieval', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const capabilities = await core.getCapabilities();
    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    expect(capabilities.value.semanticSearch).toBe(true);
    expect(capabilities.value.embeddingProfileIds).toContain(PORTABLE_HASH_PROFILE.id);

    const response = await core.search({
      query: 'Боль переместилась из околопупочной области вправо вниз, была рвота',
      mode: 'auto',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.modeUsed).toBe('hybrid');
    expect(response.value.diagnostics.semantic.status).toBe('used');
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.surgery.appendicitis');
    expect(response.value.groups[0]?.results[0]?.semanticScore).not.toBeNull();
  });

  it('falls back to lexical search on an incompatible embedding profile', async () => {
    const store = new InMemoryMedicalStore();
    const incompatibleEmbedder = new PortableHashEmbedder({
      ...PORTABLE_HASH_PROFILE,
      id: 'localmed.incompatible.16.v1',
      dimensions: 16,
      fingerprint: 'incompatible:16',
    });
    const core = createMedicalCore({
      store,
      seed: DEMO_CONTENT_PACK,
      platform: 'test',
      embedder: incompatibleEmbedder,
    });
    cores.push(core);

    const response = await core.search({
      query: 'ребенок часто дышит и температурит',
      mode: 'hybrid',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.modeUsed).toBe('lexical');
    expect(response.value.diagnostics.semantic).toMatchObject({
      status: 'fallback',
      fallbackReason: 'embedding-profile-mismatch',
    });
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
  });

  it('ranks an exact medication presentation and exposes it with the canonical MNN', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
    cores.push(core);

    const response = await core.search({
      query: 'Мирамистин мазь',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.miramistin');
    expect(response.value.groups[0]?.title).toBe(`Мирамистин мазь · ${MIRAMISTIN_MNN}`);
    expect(response.value.groups[0]?.results[0]?.title).toBe(MIRAMISTIN_MNN);
  });

  it('does not present a nonexistent medication presentation as an exact match', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
    cores.push(core);

    const response = await core.search({
      query: 'Мирамистин капсулы',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const miramistinGroup = response.value.groups.find(
      (group) => group.documentId === 'med.miramistin',
    );
    expect(miramistinGroup?.title).toBe(`Мирамистин · ${MIRAMISTIN_MNN}`);
    expect(response.value.groups.some((group) => group.title.includes('Мирамистин капсулы'))).toBe(
      false,
    );
  });

  it.each(['Нурофен', 'Нурофен суспензия', 'Нурофен детский'])(
    'ranks ИБУПРОФЕН first for %s over combination cards',
    async (query) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups[0]?.documentId).toBe('med.ibuprofen');
      expect(response.value.groups.map((group) => group.documentId)).toEqual(
        expect.arrayContaining(['med.ibuprofen-paracetamol', 'med.ibuprofen-codeine']),
      );
    },
  );

  it.each([
    {
      query: 'Нурофен суспензия',
      expectedTerms: ['Нурофен для детей', 'СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ'],
    },
    {
      query: 'Нурофен детский',
      expectedTerms: ['Нурофен для детей'],
    },
  ])('ranks the source-faithful Nurofen result first for %s', async ({ query, expectedTerms }) => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
    cores.push(core);

    const response = await core.search({
      query,
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.ibuprofen');
    const firstSnippet = response.value.groups[0]?.results[0]?.snippet ?? '';
    for (const expectedTerm of expectedTerms) expect(firstSnippet).toContain(expectedTerm);
  });

  it('uses the exact trade name from the selected Nurofen suspension row in the group title', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
    cores.push(core);

    const response = await core.search({
      query: 'Нурофен суспензия',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const ibuprofenGroup = response.value.groups.find(
      (group) => group.documentId === 'med.ibuprofen',
    );
    expect(ibuprofenGroup?.title).toBe('Нурофен для детей · ИБУПРОФЕН');
    expect(ibuprofenGroup?.title).not.toMatch(/плюс|интенсив/iu);
    expect(ibuprofenGroup?.results[0]?.snippet).toContain('100 мг/5 мл');
  });

  it('ranks the exact Nurofen presentation row before Nurofen Express', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({ store, seed: MEDICATION_SEARCH_PACK, platform: 'test' });
    cores.push(core);

    const response = await core.search({
      query: 'Нурофен',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.ibuprofen');
    const firstSnippet = response.value.groups[0]?.results[0]?.snippet ?? '';
    expect(response.value.groups[0]?.title).toBe('Нурофен · ИБУПРОФЕН');
    expect(firstSnippet).toContain('ТН: Нурофен.');
    expect(firstSnippet).toContain('200.0 мг');
    expect(firstSnippet).not.toContain('Нурофен Экспресс');
    expect(response.value.groups[0]?.title).not.toMatch(/плюс|интенсив/iu);
  });

  it.each(COMPONENT_ALIAS_CASES)(
    'ranks the direct MNN above its component-alias combination',
    async ({ query, canonical, combination, combinationOnlyTerm }) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({
        store,
        seed: COMPONENT_ALIAS_SEARCH_PACK,
        platform: 'test',
      });
      cores.push(core);

      const analysis = await core.analyzeQuery({ query, includeSuggestions: false });
      expect(analysis.ok).toBe(true);
      if (!analysis.ok) return;
      expect(analysis.value.branches.flatMap((branch) => branch.terms)).not.toContain(
        combinationOnlyTerm,
      );

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 20,
        includeSuggestions: false,
      });
      expect(response.ok).toBe(true);
      if (!response.ok) return;

      const directIndex = response.value.groups.findIndex((group) => group.title === canonical);
      const combinationIndex = response.value.groups.findIndex(
        (group) => group.title === combination,
      );
      expect(response.value.groups[0]?.title).toBe(canonical);
      expect(directIndex).toBeGreaterThanOrEqual(0);
      expect(combinationIndex).toBeGreaterThan(directIndex);
      expect(response.value.diagnostics.aliasMatches).not.toContain(
        `${canonical} → ${combination}`,
      );
    },
  );

  it.each(COMPONENT_ALIAS_CASES.filter(({ id }) => id === 'paracetamol' || id === 'salbutamol'))(
    'keeps the direct MNN first beside a suffix alias with an exact self alias',
    async ({ query, canonical, combination }) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({
        store,
        seed: COMPONENT_ALIAS_SEARCH_PACK,
        platform: 'test',
      });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups[0]?.title).toBe(canonical);
      expect(response.value.groups.some((group) => group.title === combination)).toBe(true);
    },
  );

  it('ranks the readable salbutamol aerosol result first inside its document group', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: COMPONENT_ALIAS_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'САЛЬБУТАМОЛ АЭРОЗОЛЬ',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.component.salbutamol.direct');
    const firstSnippet = response.value.groups[0]?.results[0]?.snippet ?? '';
    expect(firstSnippet).toContain('САЛЬБУТАМОЛ');
    expect(firstSnippet).toContain('аэрозоль');
    expect(firstSnippet).not.toMatch(/<\/?(?:details|summary)(?:\s|>)/iu);
  });

  it.each([
    {
      query: 'цефтриаксон внутримышечно',
      sourceForm: 'для внутримышечного введения',
    },
    {
      query: 'цефтриаксон внутривенно',
      sourceForm: 'для внутривенного введения',
    },
    {
      query: 'цефтриаксон в/м',
      sourceForm: 'для внутримышечного введения',
    },
    {
      query: 'цефтриаксон в/в',
      sourceForm: 'для внутривенного введения',
    },
  ])('keeps direct ceftriaxone first for route query %s', async ({ query, sourceForm }) => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: COMPONENT_ALIAS_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query,
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.component.ceftriaxone.direct');
    expect(response.value.groups[0]?.title).toBe('ЦЕФТРИАКСОН');
    expect(response.value.groups[0]?.results[0]?.snippet).toContain(sourceForm);
  });

  it('keeps direct ceftriaxone first and exposes pediatric context for a route query', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: COMPONENT_ALIAS_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'цефтриаксон внутривенно ребенку 12 лет 30 кг',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.component.ceftriaxone.direct');
    expect(response.value.groups[0]?.title).toBe('ЦЕФТРИАКСОН');
    expect(response.value.groups[0]?.results[0]?.snippet).toContain('для внутривенного введения');
    expect(response.value.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'age', normalizedValue: '12 лет' }),
        expect.objectContaining({ kind: 'measurement', label: 'Масса', normalizedValue: '30 кг' }),
      ]),
    );
  });

  it('does not classify a bare gram drug strength as body mass', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: COMPONENT_ALIAS_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'цефтриаксон 1 г',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.component.ceftriaxone.direct');
    expect(
      response.value.analysis.facts.some(
        (fact) => fact.kind === 'measurement' && fact.label === 'Масса',
      ),
    ).toBe(false);
  });

  it('does not duplicate an explicitly labelled body mass', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: COMPONENT_ALIAS_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'цефтриаксон ребенку 12 лет вес 30 кг',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(
      response.value.analysis.facts.filter(
        (fact) => fact.kind === 'measurement' && fact.label === 'Масса',
      ),
    ).toHaveLength(1);
  });

  it.each(['Детский Фармокс сироп', 'Детский Фармокс спироп'])(
    'finds an oral suspension when a fictional trade name is queried as %s',
    async (query) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({
        store,
        seed: FORM_EQUIVALENCE_SEARCH_PACK,
        platform: 'test',
      });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups[0]?.documentId).toBe('med.form.suspension-only');
      expect(response.value.groups[0]?.results[0]?.snippet).toContain(
        'СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ',
      );
    },
  );

  it('finds a registered syrup for a fictional trade name queried as suspension', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: FORM_EQUIVALENCE_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'Кашлестоп Плюс суспензия',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.form.syrup-only');
    expect(response.value.groups[0]?.results[0]?.snippet).toContain('Лекарственная форма: СИРОП');
  });

  it.each([
    { query: 'Форморин сироп', expectedForm: 'Лекарственная форма: СИРОП' },
    {
      query: 'Форморин суспензия',
      expectedForm: 'Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ',
    },
  ])(
    'prefers the exact source form over its equivalent for %s',
    async ({ query, expectedForm }) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({
        store,
        seed: FORM_EQUIVALENCE_SEARCH_PACK,
        platform: 'test',
      });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups[0]?.documentId).toBe('med.form.both');
      expect(response.value.groups[0]?.results[0]?.snippet).toContain(expectedForm);
    },
  );

  it('ranks a direct MNN plus form above a combination plus the same form', async () => {
    const store = new InMemoryMedicalStore();
    const core = createMedicalCore({
      store,
      seed: FORM_EQUIVALENCE_SEARCH_PACK,
      platform: 'test',
    });
    cores.push(core);

    const response = await core.search({
      query: 'Тестпарацетамол суспензия',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('med.form.direct-mnn');
    expect(response.value.groups.map((group) => group.documentId)).toEqual(
      expect.arrayContaining(['med.form.combination']),
    );
  });

  it.each([
    {
      query: 'Инъектол сироп',
      documentId: 'med.form.injection-suspension',
      sourceForm: 'СУСПЕНЗИЯ ДЛЯ ИНЪЕКЦИЙ',
    },
    {
      query: 'Наружол сироп',
      documentId: 'med.form.external-suspension',
      sourceForm: 'СУСПЕНЗИЯ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ',
    },
  ])(
    'does not treat non-oral suspension as syrup evidence for %s',
    async ({ query, documentId, sourceForm }) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({
        store,
        seed: FORM_EQUIVALENCE_SEARCH_PACK,
        platform: 'test',
      });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups[0]?.documentId).toBe(documentId);
      const firstResult = response.value.groups[0]?.results[0];
      expect(firstResult?.snippet).toContain(sourceForm);
      expect(firstResult?.matchedTerms).not.toContain('сироп');
      expect(firstResult?.matchedTerms).not.toContain('суспензия');
      expect(firstResult?.matchedTerms).not.toContain('суспенз');
      expect(firstResult?.matchedTerms).not.toContain('приема');
      expect(firstResult?.matchedTerms).not.toContain('внутрь');
    },
  );

  it.each(['турбухалер', 'турбухаер'])(
    'retrieves exactly the Turbuhaler MNN cards for %s',
    async (query) => {
      const store = new InMemoryMedicalStore();
      const core = createMedicalCore({ store, seed: TURBUHALER_SEARCH_PACK, platform: 'test' });
      cores.push(core);

      const response = await core.search({
        query,
        mode: 'lexical',
        filters: {},
        limit: 5,
        includeSuggestions: false,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.groups.length).toBeLessThanOrEqual(5);
      expect(response.value.groups).toHaveLength(3);
      expect(response.value.groups.map((group) => group.documentId)).toEqual(
        expect.arrayContaining([
          'med.turbuhaler.budesonide',
          'med.turbuhaler.budesonide-formoterol',
          'med.turbuhaler.formoterol',
        ]),
      );
      expect(
        response.value.groups.some((group) => group.documentId === 'med.turbuhaler.unrelated'),
      ).toBe(false);
      expect(
        response.value.groups.some(
          (group) => group.documentId === 'med.turbuhaler.budesonide-salbutamol',
        ),
      ).toBe(false);
      expect(
        response.value.groups.every((group) => group.results[0]?.snippet.includes('Турбухалер')),
      ).toBe(true);
      const formoterolGroup = response.value.groups.find(
        (group) => group.documentId === 'med.turbuhaler.formoterol',
      );
      expect(formoterolGroup?.results[0]?.snippet).toContain('Оксис Турбухалер');
      expect(formoterolGroup?.results[0]?.snippet).toContain('ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ');
    },
  );
});
