import type { MedicalDocumentSummary, SearchResult, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { queryGroupRelevanceBoost, rankSearchGroupsByQuery } from './query-group-ranking';

function result(
  documentId: string,
  title: string,
  snippet: string,
  matchedTerms: readonly string[] = ['парацетамол', 'суспензия'],
): SearchResult {
  return {
    chunkId: `${documentId}.chunk`,
    documentId,
    documentVersionId: `${documentId}.v1`,
    sectionId: `${documentId}.section`,
    anchor: 'registration-1',
    title,
    sectionPath: ['Регистрационные сведения'],
    snippet,
    highlightedRanges: [],
    lexicalScore: 1,
    semanticScore: null,
    finalScore: 1,
    matchedTerms,
    matchedBranches: [],
    sectionType: 'definition',
    category: 'overview',
  };
}

function group(
  documentId: string,
  title: string,
  bestScore: number,
  results: readonly SearchResult[] = [],
): SearchResultGroup {
  return {
    documentId,
    title,
    bestScore,
    categories: ['other'],
    results,
  };
}

function document(
  id: string,
  sourceType: string,
  metadata?: MedicalDocumentSummary['metadata'],
): MedicalDocumentSummary {
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
    ...(metadata ? { metadata } : {}),
  };
}

describe('query-aware group ranking', () => {
  it('does not promote generic legal titles above the requested health-group section', () => {
    const groups = [
      group('tuberculosis', 'Диспансерное наблюдение больных туберкулезом', 0.9),
      group('health', 'Группы здоровья взрослого населения — приказ № 404н', 0.72),
    ];
    for (const sourceType of ['regulatory_act_summary', 'medical_reference']) {
      const documents = groups.map((entry) =>
        document(entry.documentId, sourceType, { notLegalAdvice: true }),
      );
      expect(
        rankSearchGroupsByQuery(
          groups,
          'У взрослого пациента ХОБЛ и требуется диспансерное наблюдение. Какая группа здоровья?',
          documents,
        )[0]?.documentId,
      ).toBe('health');
    }
  });

  it('gives an explicit legal document number priority over generic wording matches', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('preventive', 'Профилактические осмотры детей — приказ № 211н', 0.95),
        group('law', 'Охрана здоровья граждан — Федеральный закон № 323-ФЗ', 0.65),
      ],
      'Кто подписывает согласие ребенку по 323-ФЗ?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['law', 'preventive']);
  });

  it('distinguishes a health-group question from a disability question with the same diagnosis', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('disability', 'Критерии инвалидности для взрослых и детей', 0.9),
        group('health', 'Группы здоровья взрослого населения — приказ № 404н', 0.72),
      ],
      'Сахарный диабет 2 типа у взрослого. Какая группа здоровья?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['health', 'disability']);
  });

  it('recognizes the colloquial profosmot wording as a preventive-exam request', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('follow-up', 'Диспансерное наблюдение несовершеннолетних — приказ № 192н', 1.1),
        group('pediatrics', 'Порядок оказания помощи по профилю «Педиатрия»', 1.05),
        group(
          'preventive',
          'Профилактические медицинские осмотры несовершеннолетних — приказ № 211н',
          0.72,
        ),
      ],
      'Как провести детский профосмотр, если в медицинской организации нет нужного специалиста?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual([
      'preventive',
      'follow-up',
      'pediatrics',
    ]);
  });

  it('demotes a superseded card when the query asks for the current order', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('old', 'Порядок оказания педиатрической помощи — приказ № 366н (утратил силу)', 1.1),
        group(
          'current',
          'Порядок оказания медицинской помощи по профилю «Педиатрия» — приказ № 120н',
          0.75,
        ),
      ],
      'Какой действующий приказ устанавливает порядок оказания медицинской помощи по профилю педиатрия?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['current', 'old']);
  });

  it('keeps a historical redirect discoverable when the query asks about an obsolete order', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('current', 'Экспертиза временной нетрудоспособности — приказ № 195н', 0.95),
        group('old', 'Экспертиза временной нетрудоспособности — приказ № 625н (утратил силу)', 0.5),
      ],
      'Приказ 625н утратил силу?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['old', 'current']);
  });

  it('preserves the base order when titles have equal query relevance', () => {
    const ranked = rankSearchGroupsByQuery(
      [group('first', 'Первый документ', 0.8), group('second', 'Второй документ', 0.7)],
      'неуточненный вопрос',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['first', 'second']);
  });

  it('ranks the exact drug name above a similarly named drug that only mentions it in passing', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('cefazolin', 'Цефазолин, порошок для приготовления раствора для инъекций', 1.4),
        group('ceftriaxone', 'Цефтриаксон, порошок для приготовления раствора для инъекций', 0.6),
      ],
      'Цефтриаксон',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['ceftriaxone', 'cefazolin']);
  });

  it('uses the ESKLP pointer as the canonical medication result unless a source is requested', () => {
    const groups = [
      group('instruction', 'Нурофен: инструкция', 3),
      group('registry', 'Нурофен: регистрационная карточка ГРЛС', 2.5),
      group('mnn', 'Нурофен · ИБУПРОФЕН', 0.4),
    ];
    const documents = [
      document('instruction', 'official_drug_instruction'),
      document('registry', 'official_registry_summary'),
      document('mnn', 'core_catalog_pointer', { catalogFamily: 'medication' }),
    ];

    expect(rankSearchGroupsByQuery(groups, 'нурофен', documents)[0]?.documentId).toBe('mnn');
    expect(rankSearchGroupsByQuery(groups, 'инструкция нурофен', documents)[0]?.documentId).toBe(
      'instruction',
    );
    expect(
      rankSearchGroupsByQuery(groups, 'регистрационный номер нурофен', documents)[0]?.documentId,
    ).toBe('registry');
  });

  it('ranks a dedicated paracetamol card above combinations and documents that only mention it', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('pneumonia', 'Внебольничная пневмония у детей', 1.45),
        group('coldrex', 'Колдрекс ХотРем', 1.2),
        group('combo', 'Парацетамол + римантадин', 1.1),
        group('paracetamol', 'Парацетамол, таблетки 500 мг', 0.4),
      ],
      'Парацетамол',
    );

    expect(ranked[0]?.documentId).toBe('paracetamol');
    expect(ranked.map((item) => item.documentId).slice(0, 2)).toEqual(['paracetamol', 'combo']);
  });

  it('ranks the direct medication title above a combination when both have suspension evidence', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('combination', 'ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ХЛОРФЕНАМИН', 1, [
          result(
            'combination',
            'ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ХЛОРФЕНАМИН',
            'Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ.',
          ),
        ]),
        group('direct', 'ПАРАЦЕТАМОЛ', 0.4, [
          result('direct', 'ПАРАЦЕТАМОЛ', 'Лекарственная форма: СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ.'),
        ]),
      ],
      'ПАРАЦЕТАМОЛ СУСПЕНЗИЯ',
    );

    expect(ranked[0]?.documentId).toBe('direct');
  });

  it('does not mistake a presentation heading with a repeated MNN for a combination', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('combination', 'ПАРАЦЕТАМОЛ+ХЛОРФЕНАМИН', 1.48),
        group('direct', 'ПАРАЦЕТАМОЛ СИРОП · ПАРАЦЕТАМОЛ', 0.4),
      ],
      'ПАРАЦЕТАМОЛ СИРОП',
    );

    expect(ranked[0]?.documentId).toBe('direct');
  });

  it('lets a specific title term beat a higher-scoring frequent body match', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('pneumonia', 'Внебольничная пневмония у детей', 1.48),
        group('drug', 'Цефтриаксон — порошок для инъекций 1 г', 0.97),
      ],
      'Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как второй антибиотик',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['drug', 'pneumonia']);
  });

  it('does not promote a failed prior medication over the condition card', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('drug', 'Амоксициллин — таблетки 500 мг', 0.37),
        group('pneumonia', 'Внебольничная пневмония у детей', 0.84),
      ],
      'чем лечить пневмонию у ребенка если амоксициллин не помог',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['pneumonia', 'drug']);
  });

  it('recognizes compact and hyphenated document numbers as the same reference', () => {
    expect(
      queryGroupRelevanceBoost(
        'Что говорит приказ 1122н о календаре прививок?',
        'Национальный календарь профилактических прививок — приказ № 1122н',
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      queryGroupRelevanceBoost(
        'Отказ от прививки по 157-ФЗ',
        'Иммунопрофилактика — Федеральный закон № 157-ФЗ',
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});
