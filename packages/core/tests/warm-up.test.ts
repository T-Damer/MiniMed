import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import { createMedicalCore } from '../src/create-medical-core';

function fixtureDocument(
  id: string,
  title: string,
  text: string,
  metadata: Record<string, unknown>,
  sourceType = 'official_registry_summary',
) {
  return {
    id,
    title,
    shortTitle: title,
    sourceType,
    status: 'active',
    specialties: [],
    metadata,
    version: {
      id: `${id}.v1`,
      label: '2026-10-05',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `checksum:${id}`,
      extractedAt: '2026-10-05T00:00:00Z',
    },
    sections: [
      {
        id: `${id}.s1`,
        parentSectionId: null,
        title: 'Определение',
        normalizedTitle: 'определение',
        sectionType: 'definition',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 's1',
        sectionPath: ['Определение'],
        chunks: [
          {
            id: `${id}.s1.1`,
            orderIndex: 0,
            originalText: text,
            normalizedText: normalizeForIndex(text),
            pageStart: null,
            pageEnd: null,
            charStart: null,
            charEnd: null,
            anchor: 's1-1',
            metadata: {},
          },
        ],
      },
    ],
  };
}

const SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.warmup',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Warm-up',
    checksum: 'test-warmup',
    builtAt: '2026-10-05T00:00:00Z',
  },
  documents: [
    fixtureDocument('med.metformin', 'МЕТФОРМИН', 'МЕТФОРМИН. Таблетки.', {
      catalogFamily: 'medication',
    }),
    fixtureDocument('med.paracetamol', 'ПАРАЦЕТАМОЛ', 'ПАРАЦЕТАМОЛ. Таблетки.', {
      catalogFamily: 'medication',
    }),
    fixtureDocument('med.nurofen', 'Нурофен', 'Нурофен. Суспензия.', {
      catalogFamily: 'medication',
      nameLat: 'Nurofen',
    }),
    fixtureDocument('ref.covid', 'COVID-19 новая коронавирусная инфекция', 'COVID-19. Описание.', {
      catalogFamily: 'reference',
    }),
    fixtureDocument('ref.amentia', 'Аменция', 'Аменция — тяжёлое помрачение сознания.', {
      catalogFamily: 'reference',
    }),
    fixtureDocument('ref.pneumonia', 'Пневмония', 'Пневмония — воспаление лёгких.', {
      catalogFamily: 'reference',
    }),
    fixtureDocument('med.vneplania', 'Внеплания', 'Внеплания. Мифепристон, таблетки.', {
      catalogFamily: 'medication',
    }),
    fixtureDocument(
      'ref.twilight',
      'Сумеречное помрачение сознания',
      'Сумеречное помрачение сознания: внезапное сужение сознания.',
      { catalogFamily: 'reference' },
    ),
    fixtureDocument(
      'card.j20.9',
      'J20.9 Острый бронхит неуточненный, МКБ-10',
      'Острый бронхит неуточненный. Код J20.9.',
      { catalogFamily: 'reference', icd10Codes: ['J20.9'] },
      'medical_reference',
    ),
    fixtureDocument(
      'kr.lower-tract',
      'Инфекции нижних дыхательных путей',
      'Клиническая рекомендация по ведению пациентов.',
      { catalogFamily: 'clinical', icd10Codes: ['J20.9', 'J22'] },
      'clinical_recommendation',
    ),
    fixtureDocument(
      'kr.other',
      'Язвенная болезнь',
      'Клиническая рекомендация по ведению пациентов.',
      { catalogFamily: 'clinical', icd10Codes: ['K25.9'] },
      'clinical_recommendation',
    ),
  ],
  aliases: [],
});

function createCore() {
  return createMedicalCore({ store: new InMemoryMedicalStore(), seed: SEED, platform: 'test' });
}

/** What a reader sees of a response: groups, their results and a correction, not timings. */
function shown(response: Awaited<ReturnType<ReturnType<typeof createCore>['search']>>) {
  if (!response.ok) return { error: response.error.code };
  return {
    groups: response.value.groups.map((group) => ({
      documentId: group.documentId,
      title: group.title,
      results: group.results.map((result) => result.chunkId),
    })),
    identities: response.value.identities?.map((hit) => hit.title) ?? [],
    correction: response.value.queryCorrection ?? null,
  };
}

const QUERIES = ['метформин', 'Nurofen', 'пневмания', 'J20.9', 'помрачение сознания', 'COVID-19'];

describe('warmUp (PERF5)', () => {
  it('leaves every search answer as it was without a warm-up', async () => {
    const cold = createCore();
    const warm = createCore();
    try {
      await warm.warmUp?.();
      for (const query of QUERIES) {
        const request = {
          query,
          mode: 'lexical' as const,
          analysisMode: 'lookup' as const,
          filters: {},
          limit: 20,
          includeSuggestions: false,
        };
        expect(shown(await warm.search(request)), query).toEqual(shown(await cold.search(request)));
      }
    } finally {
      await Promise.all([cold.close(), warm.close()]);
    }
  });

  it('is safe to repeat and after a search has built the indexes', async () => {
    const core = createCore();
    try {
      await core.search({
        query: 'метформин',
        mode: 'lexical',
        analysisMode: 'lookup',
        filters: {},
        limit: 20,
        includeSuggestions: false,
      });
      await core.warmUp?.();
      await core.warmUp?.();
      const again = await core.search({
        query: 'метформин',
        mode: 'lexical',
        analysisMode: 'lookup',
        filters: {},
        limit: 20,
        includeSuggestions: false,
      });
      expect(again.ok && again.value.groups[0]?.documentId).toBe('med.metformin');
    } finally {
      await core.close();
    }
  });
});
