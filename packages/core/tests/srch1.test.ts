import { ContentPackSeedSchema, type SearchResponse } from '@localmed/contracts';
import { type AtcDirectoryEntry, normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { createMedicalCore, type DrugCodeDirectory } from '../src/index';

// SRCH1: the search fixes of the 2026-10-14 QA pass that live in the core: a trade name typed whole
// leads and titles its card, the drugs of a named class lead the results, homeopathic mixtures go
// behind the ordinary drug cards, and a short Latin word or pasted markup finds nothing.

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
      label: '2026-10-14',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `checksum:${id}`,
      extractedAt: '2026-10-14T00:00:00Z',
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

function pointer(slug: string, title: string, text = `Стандартизированное МНН: ${title}.`) {
  return fixtureDocument(
    `core.catalog.pointer.medication.esklp.mnn.${slug}-0123456789abcdef`,
    title,
    text,
    {
      catalogFamily: 'medication',
      contentMode: 'module-pointer',
      targetDocumentId: `esklp.mnn.${slug}`,
    },
    'core_catalog_pointer',
  );
}

const SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.srch1',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'SRCH1',
    checksum: 'test-srch1',
    builtAt: '2026-10-14T00:00:00Z',
  },
  documents: [
    pointer(
      'ацетилсалициловая-кислота',
      'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
      '- ТН: Аспирин; форма/дозировка: ТАБЛЕТКИ (500 мг)\n- ТН: Ацетилсалициловая кислота Медисорб; форма/дозировка: ТАБЛЕТКИ (500 мг)',
    ),
    fixtureDocument(
      'ref.aspirin-resistance',
      'Аспиринорезистентность',
      'Аспиринорезистентность: неспособность ацетилсалициловой кислоты подавлять тромбообразование.',
      { catalogFamily: 'reference' },
      'medical_reference',
    ),
    pointer('азитромицин', 'АЗИТРОМИЦИН'),
    pointer('кларитромицин', 'КЛАРИТРОМИЦИН'),
    pointer('азитромицин-орнидазол', 'АЗИТРОМИЦИН+ОРНИДАЗОЛ'),
    pointer('амоксициллин', 'АМОКСИЦИЛЛИН'),
    fixtureDocument(
      'ref.macrolides-guideline',
      'Макролиды в лечении внебольничной пневмонии',
      'Макролиды назначают при атипичных возбудителях.',
      { catalogFamily: 'reference' },
      'medical_reference',
    ),
    pointer('ртуть-растворимая', 'РТУТЬ РАСТВОРИМАЯ ПО ГАННЕМАНУ'),
    pointer('ртуть-хлорид', 'РТУТЬ ХЛОРИД'),
    pointer('ртуть-белладонна', 'АТРОПА БЕЛЛАДОННА+РТУТЬ РАСТВОРИМАЯ ПО ГАННЕМАНУ'),
    fixtureDocument(
      'ref.apert',
      'Apert syndrome',
      'Apert syndrome is a rare craniosynostosis.',
      { catalogFamily: 'reference' },
      'medical_reference',
    ),
  ],
  aliases: [
    {
      id: 'alias.aspirin',
      canonicalTerm: 'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
      alias: 'Аспирин',
      category: 'medication',
      weight: 1,
    },
  ],
});

const ENTRIES: readonly AtcDirectoryEntry[] = [
  { id: 'esklp.mnn.азитромицин', name: 'Азитромицин', codes: ['J01FA10'], weight: 90 },
  { id: 'esklp.mnn.кларитромицин', name: 'Кларитромицин', codes: ['J01FA09'], weight: 120 },
  {
    id: 'esklp.mnn.азитромицин-орнидазол',
    name: 'Азитромицин+Орнидазол',
    codes: ['J01FA10'],
    weight: 400,
  },
  { id: 'esklp.mnn.амоксициллин', name: 'Амоксициллин', codes: ['J01CA04'], weight: 500 },
  // A card whose module the corpus holds nothing of is not listed.
  { id: 'esklp.mnn.без-модуля', name: 'Без модуля', codes: ['J01FA99'], weight: 1000 },
];

const HOMEOPATHIC = new Set(['esklp.mnn.ртуть-растворимая', 'esklp.mnn.ртуть-белладонна']);

const directory: DrugCodeDirectory = {
  entries: async () => ENTRIES,
  homeopathicIds: async () => HOMEOPATHIC,
  // The application answers this from its class vocabulary; a class word inside a longer query
  // comes back with the other words as `rest` (SRCH2).
  classOf: async (query) => {
    const [first, ...rest] = query.trim().toLowerCase().split(/\s+/u);
    if (!['макролиды', 'макролидов'].includes(first ?? '')) return null;
    return {
      label: 'Макролиды',
      groups: [{ code: 'J01FA', name: 'Макролиды' }],
      ...(rest.length > 0 ? { rest } : {}),
    };
  },
};

const cores: ReturnType<typeof createMedicalCore>[] = [];
function createCore(options: { drugCodes?: DrugCodeDirectory } = { drugCodes: directory }) {
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

async function lookup(
  query: string,
  options: { core?: ReturnType<typeof createMedicalCore>; specialties?: string[] } = {},
): Promise<SearchResponse> {
  const response = await (options.core ?? createCore()).search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    limit: 10,
    ...(options.specialties ? { filters: { specialties: options.specialties } } : {}),
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

const titles = (response: SearchResponse): string[] => response.groups.map((group) => group.title);

describe('a trade name typed whole (item 1)', () => {
  it('titles the card with the typed brand and puts it before words that merely begin with it', async () => {
    const response = await lookup('Аспирин');
    expect(titles(response)[0]).toBe('Аспирин · АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА');
    expect(titles(response)).toContain('Аспиринорезистентность');
    expect(titles(response).indexOf('Аспиринорезистентность')).toBeGreaterThan(0);
  });
});

describe('a drug class named whole (item 12)', () => {
  it('returns the class, then its drugs commoner first, then the usual documents', async () => {
    const response = await lookup('макролиды');
    expect(response.drugClass).toEqual({
      label: 'Макролиды',
      groups: [{ code: 'J01FA', name: 'Макролиды', drugCount: 3 }],
      drugCount: 3,
      listed: 3,
    });
    const leading = response.groups.slice(0, 3);
    // A single substance of the class before a combination, however common the combination is.
    expect(leading.map((group) => group.title)).toEqual([
      'КЛАРИТРОМИЦИН',
      'АЗИТРОМИЦИН',
      'АЗИТРОМИЦИН+ОРНИДАЗОЛ',
    ]);
    expect(leading.every((group) => group.atcMatch !== undefined)).toBe(true);
    expect(leading.map((group) => group.atcMatch?.code)).toEqual(['J01FA09', 'J01FA10', 'J01FA10']);
    expect(titles(response)).toContain('Макролиды в лечении внебольничной пневмонии');
    expect(titles(response).indexOf('Макролиды в лечении внебольничной пневмонии')).toBeGreaterThan(
      2,
    );
    // Not a drug of the class, and not one the corpus holds.
    expect(titles(response)).not.toContain('АМОКСИЦИЛЛИН');
    expect(titles(response)).not.toContain('Без модуля');
  });

  it('names no class for a disease, a drug, a code or a query with a filter', async () => {
    for (const query of ['пневмония', 'азитромицин', 'J01FA']) {
      expect((await lookup(query)).drugClass).toBeUndefined();
    }
    expect((await lookup('макролиды', { specialties: ['pulmonology'] })).drugClass).toBeUndefined();
    // Without a directory that knows classes nothing changes.
    const plain = await lookup('макролиды', {
      core: createCore({ drugCodes: { entries: async () => ENTRIES } }),
    });
    expect(plain.drugClass).toBeUndefined();
  });
});

describe('a drug class inside a longer query (SRCH2)', () => {
  it('returns the class and its drugs, while the documents still rank by the whole query', async () => {
    const response = await lookup('макролиды пневмония');
    expect(response.drugClass?.label).toBe('Макролиды');
    expect(response.drugClass?.drugCount).toBe(3);
    const leading = response.groups.slice(0, 3);
    expect(leading.every((group) => group.atcMatch !== undefined)).toBe(true);
    // «пневмония» is in the text of the guideline, not in the card of a macrolide.
    expect(titles(response)).toContain('Макролиды в лечении внебольничной пневмонии');
    expect(titles(response).indexOf('Макролиды в лечении внебольничной пневмонии')).toBeGreaterThan(
      2,
    );
  });

  it('shows no class when the other words name a drug, or when a filter is set', async () => {
    expect((await lookup('азитромицин макролиды')).drugClass).toBeUndefined();
    expect((await lookup('макролиды амоксициллину')).drugClass).toBeUndefined();
    expect(
      (await lookup('макролиды пневмония', { specialties: ['pulmonology'] })).drugClass,
    ).toBeUndefined();
  });
});

describe('homeopathic mixtures behind the ordinary drug cards (item 3)', () => {
  it('puts the ordinary card first when the query names it, keeping every card', async () => {
    const response = await lookup('ртуть');
    const homeopathic = response.groups.filter((group) => group.title.includes('ГАННЕМАНУ'));
    expect(homeopathic).toHaveLength(2);
    const firstHomeopathic = response.groups.findIndex((group) =>
      group.title.includes('ГАННЕМАНУ'),
    );
    expect(titles(response)[0]).toBe('РТУТЬ ХЛОРИД');
    expect(firstHomeopathic).toBeGreaterThan(0);
  });

  it('leaves the order alone when no ordinary card names the query', async () => {
    const response = await lookup('ртуть', {
      core: createCore({
        drugCodes: {
          entries: async () => ENTRIES,
          homeopathicIds: async () => new Set([...HOMEOPATHIC, 'esklp.mnn.ртуть-хлорид']),
        },
      }),
    });
    expect(response.groups.length).toBeGreaterThan(0);
  });
});

describe('text with no real word in it (item 5)', () => {
  it('does not correct a short Latin word into a rare Latin name', async () => {
    const response = await lookup('alert');
    expect(response.groups).toEqual([]);
    expect(response.queryCorrection).toBeUndefined();
    expect(await lookup('Apert')).toMatchObject({ groups: [{ title: 'Apert syndrome' }] });
  });

  it('answers pasted markup with no searchable terms', async () => {
    const core = createCore();
    for (const query of ['<img src=x onerror=alert(1)>', '<script></script>', '</b>']) {
      const result = await core.search({
        query,
        mode: 'lexical',
        analysisMode: 'lookup',
        limit: 10,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe('Search query has no searchable terms.');
    }
  });
});
