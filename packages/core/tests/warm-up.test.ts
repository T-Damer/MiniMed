import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { describe, expect, it, vi } from 'vitest';

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

describe('a quick first answer (SearchRequest.quick)', () => {
  const request = {
    query: 'пневмония',
    mode: 'lexical' as const,
    analysisMode: 'lookup' as const,
    filters: {},
    limit: 20,
    includeSuggestions: false,
  };

  it('supplies search descriptors while the navigation listing is still loading', async () => {
    let releaseNavigation = (): void => undefined;
    const navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    const memory = new InMemoryMedicalStore();
    const store = Object.assign(memory, {
      listNavigationDocuments: vi.fn(async () => {
        await navigationGate;
        return memory.listDocuments();
      }),
      listSearchDocuments: vi.fn(() => memory.listDocuments()),
    });
    const core = createMedicalCore({ store, seed: SEED, platform: 'test' });
    await core.initialize();
    const navigation = core.listNavigationDocuments?.();
    const search = core.listSearchDocuments?.();
    try {
      await vi.waitFor(() => expect(store.listSearchDocuments).toHaveBeenCalledOnce(), {
        timeout: 200,
      });
      const descriptors = await search;
      expect(descriptors?.ok && descriptors.value.some(({ id }) => id === 'ref.pneumonia')).toBe(
        true,
      );
      const quick = await core.search({ ...request, quick: true });
      expect(quick.ok && quick.value.partial).toBe(true);
      expect(await core.listSearchDocuments?.()).toEqual(descriptors);
      expect(store.listSearchDocuments).toHaveBeenCalledOnce();
    } finally {
      releaseNavigation();
      await Promise.all([navigation, search]);
      await core.close();
    }
  });

  it('answers with the words as text before the first-search indexes exist', async () => {
    const core = createCore();
    try {
      const quick = await core.search({ ...request, quick: true });
      if (!quick.ok) throw new Error(quick.error.message);
      expect(quick.value.partial).toBe(true);
      expect(quick.value.groups.map((group) => group.documentId)).toContain('ref.pneumonia');
      expect(quick.value.identities).toEqual([]);
    } finally {
      await core.close();
    }
  });

  it('is the full answer once the indexes are built', async () => {
    const core = createCore();
    try {
      const full = await core.search(request);
      const again = await core.search({ ...request, quick: true });
      if (!full.ok || !again.ok) throw new Error('search failed');
      expect(again.value.partial).toBeUndefined();
      expect(again.value.groups.map((group) => group.documentId)).toEqual(
        full.value.groups.map((group) => group.documentId),
      );
    } finally {
      await core.close();
    }
  });

  it('finds the card of a substance by a trade name typed whole, and the exact names', async () => {
    const core = createMedicalCore({
      store: new InMemoryMedicalStore(),
      seed: {
        ...SEED,
        aliases: [
          {
            id: 'alias.panadol',
            canonicalTerm: 'ПАРАЦЕТАМОЛ',
            alias: 'Панадол',
            category: 'medication',
            weight: 1,
          },
        ],
      },
      platform: 'test',
    });
    try {
      const quick = await core.search({ ...request, query: 'панадол', quick: true });
      if (!quick.ok) throw new Error(quick.error.message);
      expect(quick.value.partial).toBe(true);
      expect(quick.value.groups[0]?.documentId).toBe('med.paracetamol');
    } finally {
      await core.close();
    }
  });

  it('never answers a clinical analysis quickly', async () => {
    const core = createCore();
    try {
      const clinical = await core.search({ ...request, analysisMode: 'clinical', quick: true });
      if (!clinical.ok) throw new Error(clinical.error.message);
      expect(clinical.value.partial).toBeUndefined();
    } finally {
      await core.close();
    }
  });
});
