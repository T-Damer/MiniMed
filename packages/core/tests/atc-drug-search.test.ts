import { ContentPackSeedSchema, type SearchResponse } from '@localmed/contracts';
import { type AtcDirectoryEntry, normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { createMedicalCore, type DrugCodeDirectory } from '../src/index';

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

function pointer(slug: string, title: string) {
  return fixtureDocument(
    `core.catalog.pointer.medication.esklp.mnn.${slug}-0123456789abcdef`,
    title,
    `Стандартизированное МНН: ${title}.`,
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
    id: 'test.atc5',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'ATC5',
    checksum: 'test-atc5',
    builtAt: '2026-10-14T00:00:00Z',
  },
  documents: [
    // Installed record of a drug whose registry code is a group stub (ATC3).
    fixtureDocument(
      'esklp.mnn.умифеновир',
      'УМИФЕНОВИР',
      'Стандартизированное МНН: УМИФЕНОВИР. АТХ: L03AX.',
      { catalogFamily: 'medication', contentMode: 'esklp-mnn' },
    ),
    // The same record's catalogue pointer, as the base core holds it.
    pointer('умифеновир', 'УМИФЕНОВИР'),
    // Drugs whose module is not installed: only the pointer exists.
    pointer('ацикловир', 'АЦИКЛОВИР'),
    pointer('валацикловир', 'ВАЛАЦИКЛОВИР'),
    pointer('ибупрофен', 'ИБУПРОФЕН'),
    pointer('алендроновая-кислота', 'АЛЕНДРОНОВАЯ КИСЛОТА'),
    // An МКБ-10 card named like an ATC group.
    fixtureDocument(
      'card.m05',
      'M05 Серопозитивный ревматоидный артрит, МКБ-10',
      'Серопозитивный ревматоидный артрит. Код M05.',
      { catalogFamily: 'reference', mkbCode: 'M05', icd10Codes: ['M05'] },
      'medical_reference',
    ),
    fixtureDocument('ref.hiv', 'ВИЧ-инфекция', 'ВИЧ-инфекция. Описание.', {
      catalogFamily: 'reference',
    }),
  ],
  aliases: [],
});

const ENTRIES: readonly AtcDirectoryEntry[] = [
  {
    id: 'esklp.mnn.умифеновир',
    name: 'Умифеновир',
    codes: ['J05AX13', 'L03AX'],
    agreed: [{ code: 'J05AX13', registry: 'L03AX' }],
  },
  { id: 'esklp.mnn.ацикловир', name: 'Ацикловир', codes: ['D06BB03', 'J05AB01'] },
  { id: 'esklp.mnn.валацикловир', name: 'Валацикловир', codes: ['J05AB11'] },
  { id: 'esklp.mnn.ибупрофен', name: 'Ибупрофен', codes: ['M01AE01'] },
  { id: 'esklp.mnn.алендроновая-кислота', name: 'Алендроновая кислота', codes: ['M05BA04'] },
  // A card of a module that the corpus holds nothing of.
  { id: 'esklp.mnn.без-модуля', name: 'Без модуля', codes: ['J05AB99'] },
];

const directory: DrugCodeDirectory = { entries: async () => ENTRIES };

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
  options: {
    core?: ReturnType<typeof createMedicalCore>;
    documentIds?: string[];
    limit?: number;
  } = {},
): Promise<SearchResponse> {
  const response = await (options.core ?? createCore()).search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    limit: options.limit ?? 10,
    ...(options.documentIds ? { filters: { documentIds: options.documentIds } } : {}),
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

const ids = (response: SearchResponse): string[] =>
  response.groups.map((group) => group.documentId);
const matches = (response: SearchResponse) =>
  response.groups.flatMap((group) => (group.atcMatch ? [[group.title, group.atcMatch]] : []));

describe('searching drugs by ATC code (ATC5)', () => {
  it('finds a drug by its full code and shows the code that matched', async () => {
    const response = await lookup('J05AB01');
    expect(response.groups[0]?.documentId).toBe(
      'core.catalog.pointer.medication.esklp.mnn.ацикловир-0123456789abcdef',
    );
    expect(response.groups[0]?.atcMatch).toEqual({ code: 'J05AB01' });
    expect(response.groups[0]?.results[0]?.matchedBranches).toEqual(['Код АТХ']);
  });

  it('shows the agreed code beside the registry stub, found under either', async () => {
    for (const query of ['J05AX13', 'L03AX', 'l03']) {
      const response = await lookup(query);
      expect(matches(response)).toEqual([
        ['УМИФЕНОВИР', { code: 'J05AX13', registryCode: 'L03AX' }],
      ]);
    }
  });

  it('lists the drugs of a group prefix by name, exact level first, each drug once', async () => {
    const response = await lookup('J05');
    expect(matches(response).map(([title]) => title)).toEqual([
      'АЦИКЛОВИР',
      'ВАЛАЦИКЛОВИР',
      'УМИФЕНОВИР',
    ]);
    // The installed record stands for its pointer.
    expect(ids(response)).toContain('esklp.mnn.умифеновир');
    expect(ids(response).filter((id) => id.includes('умифеновир'))).toHaveLength(1);
    // A card whose module the corpus does not hold is not listed.
    expect(ids(response).some((id) => id.includes('без-модуля'))).toBe(false);
  });

  it('reads each level of the code', async () => {
    expect((await lookup('J05A')).groups.filter((group) => group.atcMatch)).toHaveLength(3);
    expect((await lookup('J05AB')).groups.filter((group) => group.atcMatch)).toHaveLength(2);
    expect((await lookup('J05AB1')).groups.filter((group) => group.atcMatch)).toHaveLength(1);
    expect((await lookup('J05AX')).groups.filter((group) => group.atcMatch)).toHaveLength(1);
  });

  it('tolerates case, spaces, Cyrillic look-alikes and the Russian layout', async () => {
    for (const query of ['j05ab01', ' J05 AB 01', 'J05АВ01', 'о05фи01']) {
      const response = await lookup(query);
      expect(matches(response).map(([title]) => title)).toEqual(['АЦИКЛОВИР']);
    }
  });

  it('keeps the reading of an ambiguous text that names a drug', async () => {
    // «м01ае01» is M01AE01 by look and V01FT01 by key; only the first names a drug.
    const byLook = await lookup('м01ае01');
    expect(matches(byLook).map(([title]) => title)).toEqual(['ИБУПРОФЕН']);
    expect(byLook.queryRewrite).toBeUndefined();
    // «ь01фу01» has one reading, the keys: M01AE01.
    const byKeys = await lookup('ь01фу01');
    expect(matches(byKeys).map(([title]) => title)).toEqual(['ИБУПРОФЕН']);
    expect(byKeys.queryRewrite).toEqual({ kind: 'layout', query: 'M01AE01' });
  });

  it('says which code a Russian-layout query was read as', async () => {
    const response = await lookup('о05');
    expect(response.queryRewrite).toEqual({ kind: 'layout', query: 'J05' });
    expect(matches(response).length).toBeGreaterThan(0);
    expect((await lookup('J05')).queryRewrite).toBeUndefined();
  });

  it('keeps an МКБ-10 card of the same letters and digits first', async () => {
    const response = await lookup('M05');
    expect(response.groups[0]?.documentId).toBe('card.m05');
    expect(response.groups[0]?.atcMatch).toBeUndefined();
    expect(matches(response).map(([title]) => title)).toEqual(['АЛЕНДРОНОВАЯ КИСЛОТА']);
  });

  it('keeps the group card back when the same letters are an МКБ-10 card', async () => {
    const withClasses: DrugCodeDirectory = {
      entries: async () => ENTRIES,
      classOf: async (query) => {
        const code = query.trim().toUpperCase();
        return ['M05', 'J05'].includes(code)
          ? { label: `Группа ${code}`, groups: [{ code, name: null }], code }
          : null;
      },
    };
    const core = createCore({ drugCodes: withClasses });
    // M05 is also a diagnosis: the card leads and no drug-group card pushes it down.
    const icd = await lookup('M05', { core });
    expect(icd.drugClass).toBeUndefined();
    expect(icd.groups[0]?.documentId).toBe('card.m05');
    // J05 is no card of the corpus: the group card shows.
    expect((await lookup('J05', { core })).drugClass?.label).toBe('Группа J05');
  });

  it('is no code lookup for a name, a mixed query or a letter with one digit', async () => {
    for (const query of ['ацикловир', 'J05 ацикловир', 'ВИЧ', 'С3']) {
      const response = await lookup(query);
      expect(matches(response)).toEqual([]);
    }
    // The name still finds the drug by the ordinary search.
    expect(ids(await lookup('ацикловир'))).toContain(
      'core.catalog.pointer.medication.esklp.mnn.ацикловир-0123456789abcdef',
    );
  });

  it('finds nothing extra for a code no drug carries', async () => {
    const response = await lookup('B12');
    expect(matches(response)).toEqual([]);
    expect(response.queryRewrite).toBeUndefined();
  });

  it('stays inside the documents of the requested scope and the limit', async () => {
    const scoped = await lookup('J05', {
      documentIds: ['core.catalog.pointer.medication.esklp.mnn.ацикловир-0123456789abcdef'],
    });
    expect(ids(scoped)).toEqual([
      'core.catalog.pointer.medication.esklp.mnn.ацикловир-0123456789abcdef',
    ]);
    expect((await lookup('J05', { limit: 2 })).groups).toHaveLength(2);
  });

  it('is an ordinary text query without a directory', async () => {
    const response = await lookup('J05AB01', { core: createCore({}) });
    expect(matches(response)).toEqual([]);
  });

  it('does not touch a clinical (case) query', async () => {
    const response = await createCore().search({
      query: 'J05AB01',
      mode: 'lexical',
      analysisMode: 'clinical',
      limit: 10,
    });
    expect(response.ok && matches(response.value)).toEqual([]);
  });
});
