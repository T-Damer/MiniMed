import { ContentPackSeedSchema, type SearchFilters } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMedicalCore } from '../src/create-medical-core';

// Deliberately synthetic source text: these fixtures test identity/navigation, not clinical claims.
const CONCEPT = 'mesh.M0000001';
const TERM = 'discovery.medical.term.mesh.M0000001';
const DETAIL = 'medical.term.mesh.M0000001';
const RELATED = 'medical.term.mesh.M0000002';
const BY_PROXY = 'medical.term.mesh.M0000003';
const names = ['Синдром Мюнхгаузена', 'Munchausen Syndrome', 'Мюнхгаузен синдром'];

function doc(id: string, title: string, text: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    title,
    shortTitle: title,
    sourceType: id.startsWith('discovery.') ? 'core_catalog_pointer' : 'medical_reference',
    status: 'active',
    specialties: ['psychiatry'],
    metadata,
    version: {
      id: `${id}@2026`,
      label: '2026',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `test:${id}`,
      extractedAt: '2026-09-14T00:00:00Z',
    },
    sections: [
      {
        id: `${id}.section`,
        parentSectionId: null,
        title: 'Определение',
        normalizedTitle: 'определение',
        sectionType: 'definition',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: `${id}/definition`,
        sectionPath: ['Определение'],
        chunks: [
          {
            id: `${id}.chunk`,
            orderIndex: 0,
            originalText: text,
            normalizedText: normalizeForIndex(text),
            pageStart: null,
            pageEnd: null,
            charStart: null,
            charEnd: null,
            anchor: `${id}/definition#one`,
            metadata: {},
          },
        ],
      },
    ],
  };
}
function term(
  id: string,
  concept: string,
  labels: string[],
  related: string[] = [],
  edition = '2026',
) {
  return doc(
    id,
    labels[0] ?? id,
    `${labels.join('; ')}. Synthetic definition with unique phrase evidencefixture.`,
    {
      pointerKind: 'terminology',
      contentMode: id.startsWith('discovery.') ? 'module-pointer' : 'terminology-reference',
      entityType: 'syndrome',
      primaryModuleId: 'minimed.terminology.F03',
      moduleIds: ['minimed.terminology.F03'],
      targetDocumentId: id === TERM ? DETAIL : id,
      terminology: {
        version: 1,
        edition,
        conceptId: concept,
        names: labels,
        relatedConceptIds: related,
        definitionLanguages: ['en'],
        discovery: id.startsWith('discovery.'),
        targetDocumentId: id === TERM ? DETAIL : id,
      },
    },
  );
}
function pack(documents: ReturnType<typeof doc>[]) {
  return ContentPackSeedSchema.parse({
    manifest: {
      id: 'test.terminology',
      version: '1',
      schemaVersion: 2,
      title: 'Terminology integration fixture',
      checksum: 'test-terms',
      builtAt: '2026-09-14T00:00:00Z',
    },
    documents,
    aliases: [],
    embeddingProfiles: [],
    embeddings: [],
  });
}
const open: ReturnType<typeof createMedicalCore>[] = [];
afterEach(async () => {
  for (const core of open.splice(0)) await core.close();
});
async function setup(
  documents = [
    term(TERM, CONCEPT, names, ['mesh.M0000002']),
    doc(
      'source.mention',
      'Тестовая глава источника',
      'В источнике упоминается Синдром Мюнхгаузена; это тест, не медицинская справка.',
    ),
    term(RELATED, 'mesh.M0000002', ['Narrower test concept']),
    term(BY_PROXY, 'mesh.M0000003', ['Munchausen Syndrome by Proxy']),
  ],
) {
  const store = new InMemoryMedicalStore();
  const core = createMedicalCore({ store, seed: pack(documents), platform: 'test' });
  open.push(core);
  await core.initialize();
  return { core, store };
}
async function search(
  core: ReturnType<typeof createMedicalCore>,
  query = names[0] ?? '',
  filters: SearchFilters = {},
) {
  const result = await core.search({
    query,
    filters,
    mode: 'lexical',
    analysisMode: 'lookup',
    limit: 20,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('source-backed terminology lookup', () => {
  it('orders the term itself, literal source occurrences, then explicitly related concepts', async () => {
    const { core } = await setup();
    const result = await search(core);
    expect(result.groups.slice(0, 3).map((group) => group.documentId)).toEqual([
      TERM,
      'source.mention',
      RELATED,
    ]);
    expect(result.groups.slice(0, 3).map((group) => group.terminologyMatch)).toEqual([
      'term',
      'term-mention',
      'related-term',
    ]);
    expect(result.groups.find((group) => group.documentId === BY_PROXY)?.terminologyMatch).not.toBe(
      'term',
    );
  });

  it('finds a sourced definition without requiring its concept name in the query', async () => {
    const { core } = await setup();
    const result = await search(core, 'evidencefixture');
    expect(result.groups.some((group) => group.documentId === TERM)).toBe(true);
  });

  it('keeps a definition readable in core-only discovery without pretending the detail pack is installed', async () => {
    const { core } = await setup();
    const result = await search(core);
    const found = result.groups.find((group) => group.documentId === TERM);
    expect(found?.documentId).toBe(TERM);
    const readable = await core.getDocument(TERM);
    expect(readable.ok && readable.value.metadata?.['terminology']).toMatchObject({
      discovery: true,
      definitionLanguages: ['en'],
    });
    expect(readable.ok && readable.value.sourceType).toBe('core_catalog_pointer');
    expect(readable.ok && readable.value.metadata?.['targetDocumentId']).toBe(DETAIL);
    expect((await core.getDocument(DETAIL)).ok).toBe(false);
  });

  it('source-name expansion finds English occurrences from a Russian name query', async () => {
    const { core } = await setup([
      term(TERM, CONCEPT, names),
      doc(
        'english.source',
        'English chapter',
        'The source explicitly mentions Munchausen Syndrome.',
      ),
    ]);
    const result = await search(core);
    expect(
      result.groups.find((group) => group.documentId === 'english.source')?.terminologyMatch,
    ).toBe('term-mention');
  });

  it('never widens an explicit document or specialty filter for term or related searches', async () => {
    const { core } = await setup();
    expect(
      (await search(core, names[0], { documentIds: ['source.mention'] })).groups.map(
        (group) => group.documentId,
      ),
    ).toEqual(['source.mention']);
    expect(
      (await search(core, names[0], { specialties: ['not-a-present-specialty'] })).groups,
    ).toEqual([]);
  });

  it('replaces discovery with an installed detail only in the exact same terminology edition', async () => {
    const { core } = await setup([term(TERM, CONCEPT, names), term(DETAIL, CONCEPT, names)]);
    expect((await search(core)).groups.map((group) => group.documentId)).toEqual([DETAIL]);
    const older = await setup([
      term(TERM, CONCEPT, names),
      term(DETAIL, CONCEPT, names, [], '2025'),
    ]);
    expect((await search(older.core)).groups.map((group) => group.documentId)).toEqual(
      expect.arrayContaining([TERM, DETAIL]),
    );
  });

  it('retains ambiguous names as distinct concepts, not an automatic equivalence merge', async () => {
    const { core } = await setup([
      term(TERM, CONCEPT, ['Общий тестовый термин']),
      term(RELATED, 'mesh.M0000002', ['Общий тестовый термин']),
    ]);
    expect(
      (await search(core, 'Общий тестовый термин')).groups.filter(
        (group) => group.terminologyMatch === 'term',
      ),
    ).toHaveLength(2);
  });

  it('invalidates cached name and document indexes when reinitializing after a corpus change', async () => {
    const { core, store } = await setup();
    await search(core);
    const documents = await store.listDocuments();
    const list = vi
      .spyOn(store, 'listDocuments')
      .mockResolvedValue(documents.map((entry) => ({ ...entry, metadata: {} })));
    await core.initialize();
    const result = await search(core);
    expect(list).toHaveBeenCalled();
    expect(result.groups.every((group) => group.terminologyMatch === undefined)).toBe(true);
  });
});
