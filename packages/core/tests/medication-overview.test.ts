import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { createMedicalCore } from '../src/create-medical-core';
import { pickOverviewSection } from '../src/medication-overview';

interface FixtureSection {
  readonly title: string;
  readonly text: string;
  readonly sectionType?: string | null;
}

function fixtureDocument(
  id: string,
  title: string,
  sourceType: string,
  metadata: Record<string, unknown>,
  sections: readonly FixtureSection[],
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
      label: '2026-10-09',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `checksum:${id}`,
      extractedAt: '2026-10-09T00:00:00Z',
    },
    sections: sections.map((section, index) => ({
      id: `${id}.s${index}`,
      parentSectionId: null,
      title: section.title,
      normalizedTitle: normalizeForIndex(section.title),
      sectionType: section.sectionType ?? null,
      depth: 1,
      orderIndex: index,
      pageStart: null,
      pageEnd: null,
      anchor: `s${index}`,
      sectionPath: [section.title],
      chunks: [
        {
          id: `${id}.s${index}.1`,
          orderIndex: 0,
          originalText: section.text,
          normalizedText: normalizeForIndex(section.text),
          pageStart: null,
          pageEnd: null,
          charStart: null,
          charEnd: null,
          anchor: `s${index}-1`,
          metadata: {},
        },
      ],
    })),
  };
}

const POINTER_TEXT = 'Стандартизированное МНН: АМОКСИЦИЛЛИН. Полные данные в модуле.';
const SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.overview',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Drug overview',
    checksum: 'test-overview',
    builtAt: '2026-10-09T00:00:00Z',
  },
  documents: [
    fixtureDocument(
      'pointer.amoxicillin',
      'АМОКСИЦИЛЛИН',
      'core_catalog_pointer',
      {
        catalogFamily: 'medication',
        contentMode: 'module-pointer',
        targetDocumentId: 'esklp.mnn.amoxicillin',
      },
      [{ title: 'Указатель препарата', text: POINTER_TEXT }],
    ),
    fixtureDocument(
      'allmed.other',
      'Амоксициллин ДС',
      'allmed_reference',
      { linkedMnnDocumentId: 'esklp.mnn.amoxicillin' },
      [
        { title: 'Состав', text: 'Амоксициллин' },
        { title: 'Фармакологическое действие', text: 'Из другой карточки.' },
      ],
    ),
    fixtureDocument(
      'allmed.amoxicillin',
      'Амоксициллин',
      'allmed_reference',
      { linkedMnnDocumentId: 'esklp.mnn.amoxicillin' },
      [
        { title: 'Состав', text: 'Амоксициллин' },
        { title: 'Показания', text: 'Инфекции дыхательных путей; отит; пневмония.' },
        { title: 'Фармакологическое действие', text: 'Антибактериальное широкого спектра.' },
        {
          title: 'Лекарственная форма',
          text: 'Амоксициллин, таблетки 500 мг; капсулы 250 мг.',
        },
      ],
    ),
    fixtureDocument(
      'pointer.aspirin',
      'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
      'core_catalog_pointer',
      {
        catalogFamily: 'medication',
        contentMode: 'module-pointer',
        targetDocumentId: 'esklp.mnn.aspirin',
      },
      [
        {
          title: 'Указатель препарата',
          text: 'Стандартизированное МНН: АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА.',
        },
      ],
    ),
  ],
  aliases: [],
});

const cores: ReturnType<typeof createMedicalCore>[] = [];
function createCore() {
  const core = createMedicalCore({
    store: new InMemoryMedicalStore(),
    seed: SEED,
    platform: 'test',
  });
  cores.push(core);
  return core;
}
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

const lookup = (query: string) =>
  createCore().search({ query, mode: 'lexical', analysisMode: 'lookup', limit: 10 });

describe('drug overview line', () => {
  it('puts the pharmacological action of the linked product record ahead of the identity line', async () => {
    const response = await lookup('амоксициллин');
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const pointer = response.value.groups.find(
      (group) => group.documentId === 'pointer.amoxicillin',
    );
    const first = pointer?.results[0];
    expect(first?.documentId).toBe('allmed.amoxicillin');
    expect(first?.sectionPath).toEqual(['Фармакологическое действие']);
    expect(first?.snippet).toContain('Антибактериальное широкого спектра');
    // The identity line stays available behind the overview.
    expect(
      pointer?.results.some((result) => result.snippet.includes('Стандартизированное МНН')),
    ).toBe(true);
  });

  it('moves the overview of a product record to the front instead of repeating it', async () => {
    const response = await lookup('амоксициллин');
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const card = response.value.groups.find((group) => group.documentId === 'allmed.amoxicillin');
    expect(card?.results[0]?.sectionPath).toEqual(['Фармакологическое действие']);
    const chunkIds = card?.results.map((result) => result.chunkId) ?? [];
    expect(new Set(chunkIds).size).toBe(chunkIds.length);
  });

  it('keeps the passage a dose form asks for', async () => {
    const response = await lookup('амоксициллин капсулы');
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const card = response.value.groups.find((group) => group.documentId === 'allmed.amoxicillin');
    expect(card?.results[0]?.sectionPath).toEqual(['Лекарственная форма']);
  });

  it('leaves a pointer without a linked record as it is', async () => {
    const response = await lookup('ацетилсалициловая кислота');
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const pointer = response.value.groups.find((group) => group.documentId === 'pointer.aspirin');
    expect(pointer?.results[0]?.sectionPath).toEqual(['Указатель препарата']);
  });
});

describe('pickOverviewSection', () => {
  const section = (title: string, sectionType: string | null, orderIndex: number) => ({
    id: title,
    documentVersionId: 'v',
    parentSectionId: null,
    title,
    normalizedTitle: title.toLowerCase(),
    sectionType,
    depth: 1,
    orderIndex,
    pageStart: null,
    pageEnd: null,
    anchor: title,
    sectionPath: [title],
  });

  it('prefers the pharmacotherapeutic group, then the action, then the indications', () => {
    expect(
      pickOverviewSection([
        section('Показания к применению', 'indications', 0),
        section('Фармакодинамика', 'pharmacology', 1),
        section('Фармакотерапевтическая группа', 'pharmacology', 2),
      ])?.title,
    ).toBe('Фармакотерапевтическая группа');
    expect(
      pickOverviewSection([
        section('Показания к применению', 'indications', 0),
        section('Фармакологическое действие', null, 1),
      ])?.title,
    ).toBe('Фармакологическое действие');
    expect(pickOverviewSection([section('Состав', null, 0)])).toBeUndefined();
  });
});
