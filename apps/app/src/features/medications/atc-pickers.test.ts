/**
 * ATC5: every place a doctor searches or picks a drug takes an ATC code beside the name. The core
 * here is the real search core over a small in-memory corpus (catalogue pointers, as the base core
 * holds them), with the drug directory the app builds from the comparison index.
 */
import { ContentPackSeedSchema, type MedicalCore } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

import {
  atcDirectoryEntries,
  homeopathicCardIds,
} from '@/features/drug-comparison/comparison-atc-directory';
import { findDrugs, resolveDrugName } from '@/features/drug-comparison/comparison-candidates';
import { fixtureAsset } from '@/features/drug-comparison/comparison-test-fixtures';
import { findDrugCandidates, resolveTypedName } from '@/features/drug-interactions/drug-candidates';
import { buildFixtureIndex as interactionIndex } from '@/features/drug-interactions/interaction-test-fixtures';
import { resolveSafetyCandidate } from '@/features/medication-safety/safety-candidates';
import { buildFixtureIndex as safetyIndex } from '@/features/medication-safety/safety-test-fixtures';
import { findDoseCandidates } from '@/features/prescription/dose-candidates';
import { createDoseIndex, parseDoseRuleIndex } from '@/features/prescription/dose-index';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';

function pointer(slug: string, title: string) {
  const id = `core.catalog.pointer.medication.esklp.mnn.${slug}-0123456789abcdef`;
  const text = `Стандартизированное МНН: ${title}.`;
  return {
    id,
    title,
    shortTitle: title,
    sourceType: 'core_catalog_pointer',
    status: 'active',
    specialties: [],
    metadata: {
      catalogFamily: 'medication',
      contentMode: 'module-pointer',
      targetDocumentId: `esklp.mnn.${slug}`,
    },
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

const SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.atc5.pickers',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'ATC5 pickers',
    checksum: 'test-atc5-pickers',
    builtAt: '2026-10-14T00:00:00Z',
  },
  documents: [pointer('ибупрофен', 'ИБУПРОФЕН'), pointer('парацетамол', 'ПАРАЦЕТАМОЛ')],
  aliases: [],
});

const cores: MedicalCore[] = [];
function createCore(): MedicalCore {
  const core = createMedicalCore({
    store: new InMemoryMedicalStore(),
    seed: SEED,
    platform: 'test',
    drugCodes: { entries: async () => atcDirectoryEntries(fixtureAsset()) },
  });
  cores.push(core);
  return core;
}
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

describe('the drug directory of the comparison index', () => {
  it('carries the codes of every card, and the agreed pair beside the registry stub', () => {
    const asset = fixtureAsset();
    const [first] = asset.cards;
    if (!first) throw new Error('fixture has no cards');
    const withPair = {
      ...asset,
      cards: [{ ...first, a: ['J05AX13', 'L03AX'], q: [['J05AX13', 'L03AX']] as const }],
    };
    expect(atcDirectoryEntries(withPair)).toEqual([
      {
        id: `esklp.mnn.${first.s}`,
        name: first.n,
        codes: ['J05AX13', 'L03AX'],
        // How common the drug is (registrations): orders the drugs of a class (SRCH1).
        weight: first.r,
        agreed: [{ code: 'J05AX13', registry: 'L03AX' }],
      },
    ]);
    expect(atcDirectoryEntries(asset).map((entry) => entry.codes)).toEqual([
      ['M01AE01'],
      ['N02BE01'],
    ]);
  });

  it('names as homeopathic only the cards whose every group says so (SRCH1)', () => {
    const asset = fixtureAsset();
    const [first, second] = asset.cards;
    if (!first || !second) throw new Error('fixture has no cards');
    const cards = [
      { ...first, s: 'only', g: ['гомеопатическое средство'] },
      { ...second, s: 'mixed', g: ['гомеопатическое средство', 'вяжущее средство'] },
      { ...second, s: 'ordinary', g: ['нестероидное противовоспалительное средство'] },
      { ...second, s: 'ungrouped', g: [] },
    ];
    expect([...homeopathicCardIds({ ...asset, cards })]).toEqual(['esklp.mnn.only']);
  });

  it('repairs a registry code written with Cyrillic look-alike letters', () => {
    const asset = fixtureAsset();
    const [first] = asset.cards;
    if (!first) throw new Error('fixture has no cards');
    expect(
      atcDirectoryEntries({ ...asset, cards: [{ ...first, a: ['М01АЕ01'] }] })[0]?.codes,
    ).toEqual(['M01AE01']);
  });
});

describe('the main search by ATC code, per scope', () => {
  it.each(['all', 'medications'] as const)('lists the drug in the scope «%s»', async (scope) => {
    const result = await new ScopedMedicalCore(createCore(), scope).search({
      query: 'N02BE01',
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((group) => [group.title, group.atcMatch])).toEqual([
      ['ПАРАЦЕТАМОЛ', { code: 'N02BE01' }],
    ]);
    expect(result.value.groups[0]?.contentKind).toBe('pointer');
  });
});

describe('the drug comparison picker', () => {
  it('suggests drugs by a code or a prefix, with the code that matched', async () => {
    const core = createCore();
    expect((await findDrugs(core, 'M01AE01')).map((drug) => [drug.slug, drug.atc?.code])).toEqual([
      ['ибупрофен', 'M01AE01'],
    ]);
    expect((await findDrugs(core, 'n02')).map((drug) => drug.slug)).toEqual(['парацетамол']);
    // Typed with the Russian layout: «т02» is N02.
    expect((await findDrugs(core, 'т02')).map((drug) => drug.slug)).toEqual(['парацетамол']);
    expect(await findDrugs(core, 'C09')).toEqual([]);
  });

  it('still finds a drug by its name', async () => {
    const found = await findDrugs(createCore(), 'ибупрофен');
    // The substance first; the shared name rule (SRCH1) lists the combinations that carry it after.
    expect(found[0]?.slug).toBe('ибупрофен');
    expect(found.every((drug) => drug.slug.includes('ибупрофен'))).toBe(true);
    expect(found[0]?.atc).toBeUndefined();
  });

  it('resolves a name given as a code, a prefix only when it holds one drug', async () => {
    const core = createCore();
    expect((await resolveDrugName(core, 'M01AE01'))?.slug).toBe('ибупрофен');
    expect((await resolveDrugName(core, 'M01'))?.slug).toBe('ибупрофен');
    // «N0» is no code; «Z99» is one that no drug carries.
    expect(await resolveDrugName(core, 'Z99')).toBeNull();
  });
});

describe('the interaction checker picker', () => {
  it('suggests and resolves drugs by code', async () => {
    const core = createCore();
    const index = interactionIndex();
    const found = await findDrugCandidates(core, index, 'M01AE01');
    expect(found.map((candidate) => [candidate.slug, candidate.atc?.code])).toEqual([
      ['ибупрофен', 'M01AE01'],
    ]);
    expect((await resolveTypedName(core, index, 'M01')).map((candidate) => candidate.slug)).toEqual(
      ['ибупрофен'],
    );
    expect(await resolveTypedName(core, index, 'Z99')).toEqual([]);
  });
});

describe('the prescription and dose pickers', () => {
  const doses = createDoseIndex(
    parseDoseRuleIndex({
      schemaVersion: 1,
      basis: { esklpEdition: 'test', modules: [] },
      modules: ['module.test'],
      forms: ['таблетки'],
      cards: [
        {
          s: 'ибупрофен',
          n: 'Ибупрофен',
          r: [[0, '200 мг', 0, [10]]],
          l: 'Ibuprofenum',
          t: [],
          a: ['M01AE01'],
          x: null,
          e: 1,
        },
      ],
      documents: {},
    }),
  );

  it('suggests drugs by code and refuses an ambiguous prefix in a strict question', async () => {
    const core = createCore();
    const found = await findDoseCandidates(core, doses, 'M01AE01');
    expect(found.map((candidate) => [candidate.slug, candidate.atc?.code])).toEqual([
      ['ибупрофен', 'M01AE01'],
    ]);
    const strict = await findDoseCandidates(core, doses, 'M01', { limit: 1, strict: true });
    expect(strict.map((candidate) => candidate.slug)).toEqual(['ибупрофен']);
    expect(await findDoseCandidates(core, doses, 'Z99', { strict: true })).toEqual([]);
  });
});

describe('the safety question', () => {
  it('resolves the drug of a code', async () => {
    const candidate = await resolveSafetyCandidate(createCore(), safetyIndex(), 'M01AE01');
    expect(candidate?.slug).toBe('ибупрофен');
    expect(await resolveSafetyCandidate(createCore(), safetyIndex(), 'Z99')).toBeNull();
  });
});
