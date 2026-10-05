import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

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
    id: 'test.s3',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'S3 fallbacks',
    checksum: 'test-s3',
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

const cores: ReturnType<typeof createMedicalCore>[] = [];
function createCore(options: { nameVariants?: boolean; icdBridge?: boolean } = {}) {
  const core = createMedicalCore({
    store: new InMemoryMedicalStore(),
    seed: SEED,
    platform: 'test',
    ...options,
  });
  cores.push(core);
  return core;
}
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

const lookup = (core: ReturnType<typeof createMedicalCore>, query: string) =>
  core.search({ query, mode: 'lexical', analysisMode: 'lookup', limit: 10 });

describe('name-variant fallback', () => {
  it.each([
    ['vtnajhvby', 'med.metformin', 'layout'],
    ['ьуеащкьшт', 'med.metformin', 'layout-transliteration'],
    ['paracetamol', 'med.paracetamol', 'transliteration'],
    ['nurofen', 'med.nurofen', 'latin-name'],
    ['тгкщаут', 'med.nurofen', 'latin-name'],
  ])('finds %s as %s through %s', async (query, expected, kind) => {
    const response = await lookup(createCore(), query);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe(expected);
    expect(response.value.queryRewrite?.kind).toBe(kind);
  });

  it('leaves the response alone when the typed form is disabled', async () => {
    const response = await lookup(createCore({ nameVariants: false }), 'vtnajhvby');
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.value.groups).toEqual([]);
      expect(response.value.queryRewrite).toBeUndefined();
    }
  });

  it('never rewrites a query whose own title matches', async () => {
    for (const query of ['COVID-19', 'метформин', 'covid']) {
      const response = await lookup(createCore(), query);
      expect(response.ok).toBe(true);
      if (response.ok) expect(response.value.queryRewrite).toBeUndefined();
    }
  });

  it('does not search a rewrite that resembles no name of the corpus', async () => {
    const response = await lookup(createCore(), 'qwertyuiop');
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value.queryRewrite).toBeUndefined();
  });
});

describe('МКБ → recommendation bridge', () => {
  const search = (core: ReturnType<typeof createMedicalCore>) =>
    core.search({
      query: 'острый бронхит неуточненный',
      mode: 'lexical',
      analysisMode: 'clinical',
      limit: 10,
    });

  it('adds the recommendations that list the code of a matched card, right behind it', async () => {
    const response = await search(createCore({ icdBridge: true }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const ids = response.value.groups.map((group) => group.documentId);
    expect(ids).toContain('kr.lower-tract');
    expect(ids).not.toContain('kr.other');
    expect(
      response.value.groups.find((group) => group.documentId === 'kr.lower-tract')?.results[0]
        ?.matchedBranches,
    ).toEqual(['Рекомендация по коду МКБ J20.9']);
  });

  it('also bridges a name lookup whose first group is the card', async () => {
    const response = await createCore().search({
      query: 'острый бронхит неуточненный',
      mode: 'lexical',
      analysisMode: 'lookup',
      limit: 10,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const ids = response.value.groups.map((group) => group.documentId);
    expect(ids[0]).toBe('card.j20.9');
    expect(ids).toContain('kr.lower-tract');
  });

  it('adds nothing to a lookup whose first group carries no code', async () => {
    const response = await createCore().search({
      query: 'метформин',
      mode: 'lexical',
      analysisMode: 'lookup',
      limit: 10,
    });
    expect(response.ok).toBe(true);
    if (response.ok)
      expect(
        response.value.groups.map((group) => group.documentId).some((id) => id.startsWith('kr.')),
      ).toBe(false);
  });

  it('changes nothing when switched off', async () => {
    const response = await search(createCore({ icdBridge: false }));
    expect(response.ok).toBe(true);
    if (response.ok)
      expect(response.value.groups.map((group) => group.documentId)).not.toContain(
        'kr.lower-tract',
      );
  });
});
