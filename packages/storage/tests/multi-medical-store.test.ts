import type { ContentPackSeed } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { InMemoryMedicalStore, MultiMedicalStore } from '../src';

function seed(options: {
  readonly packId: string;
  readonly documentId: string;
  readonly term: string;
  readonly fingerprint?: string;
  readonly schemaVersion?: number;
}): ContentPackSeed {
  const versionId = `${options.documentId}@1`;
  const sectionId = `${versionId}/section`;
  const chunkId = `${sectionId}#chunk-1`;
  return {
    manifest: {
      id: options.packId,
      version: '1.0.0',
      schemaVersion: options.schemaVersion ?? 2,
      title: options.packId,
      checksum: `sha256:${options.packId}`,
      builtAt: '2026-07-21T00:00:00Z',
    },
    documents: [
      {
        id: options.documentId,
        title: `Документ ${options.documentId}`,
        shortTitle: null,
        sourceType: 'test',
        status: 'active',
        specialties: ['pediatrics'],
        metadata: { ageGroups: ['children'] },
        version: {
          id: versionId,
          label: '1',
          effectiveFrom: null,
          effectiveTo: null,
          sourceChecksum: `sha256:${options.documentId}`,
          extractedAt: '2026-07-21T00:00:00Z',
        },
        sections: [
          {
            id: sectionId,
            parentSectionId: null,
            title: 'Раздел',
            normalizedTitle: 'раздел',
            sectionType: 'clinical-picture',
            depth: 1,
            orderIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            anchor: sectionId,
            sectionPath: ['Раздел'],
            chunks: [
              {
                id: chunkId,
                orderIndex: 0,
                originalText: `${options.term} полный текст`,
                normalizedText: `${options.term} полный текст`,
                pageStart: 1,
                pageEnd: 1,
                charStart: 0,
                charEnd: 20,
                anchor: chunkId,
                metadata: {},
              },
            ],
          },
        ],
      },
    ],
    aliases: [
      {
        id: `alias.${options.documentId}`,
        canonicalTerm: options.term,
        alias: options.term,
        category: 'test',
        weight: 1,
      },
    ],
    embeddingProfiles: [
      {
        id: 'test-profile',
        dimensions: 2,
        vectorFormat: 'int8',
        normalization: 'l2',
        generator: 'test',
        generatorVersion: '1',
        fingerprint: options.fingerprint ?? 'shared',
        metadata: {},
      },
    ],
    embeddings: [
      {
        profileId: 'test-profile',
        chunkId,
        values: [127, 0],
        norm: 127,
      },
    ],
  };
}

async function store(value: ContentPackSeed): Promise<InMemoryMedicalStore> {
  const result = new InMemoryMedicalStore();
  await result.initialize(value);
  return result;
}

describe('MultiMedicalStore', () => {
  it('combines enabled stores and routes exact records', async () => {
    const core = await store(seed({ packId: 'core', documentId: 'core.topic', term: 'лихорадка' }));
    const clinical = await store(
      seed({ packId: 'clinical', documentId: 'clinical.fever', term: 'лихорадка' }),
    );
    const multi = new MultiMedicalStore([
      { moduleId: 'core', store: core, required: true, searchWeight: 0.8 },
      { moduleId: 'clinical', store: clinical, searchWeight: 1.2 },
    ]);

    const health = await multi.initialize();
    const hits = await multi.search({
      ftsQuery: 'лихорадка',
      terms: ['лихорадка'],
      filters: {},
      limit: 10,
    });

    expect(health.backend).toBe('multi-store');
    expect(health.contentPackIds).toEqual(['clinical', 'core']);
    expect(health.documentCount).toBe(2);
    expect((await multi.getDocument('clinical.fever'))?.contentPackId).toBe('clinical');
    expect(hits.map((hit) => hit.document.id)).toEqual(['clinical.fever', 'core.topic']);
  });

  it('removes disabled optional modules from search without closing them', async () => {
    const core = await store(seed({ packId: 'core', documentId: 'core.topic', term: 'кашель' }));
    const clinical = await store(
      seed({ packId: 'clinical', documentId: 'clinical.cough', term: 'кашель' }),
    );
    const multi = new MultiMedicalStore([
      { moduleId: 'core', store: core, required: true },
      { moduleId: 'clinical', store: clinical },
    ]);
    await multi.initialize();

    await multi.setEnabled('clinical', false);
    const hits = await multi.search({
      ftsQuery: 'кашель',
      terms: ['кашель'],
      filters: {},
      limit: 10,
    });

    expect(hits.map((hit) => hit.document.id)).toEqual(['core.topic']);
    expect((await multi.getHealth()).documentCount).toBe(1);
    await expect(multi.setEnabled('core', false)).rejects.toThrow('cannot be disabled');
  });

  it('rejects duplicate global document IDs', async () => {
    const first = await store(seed({ packId: 'one', documentId: 'duplicate', term: 'один' }));
    const second = await store(seed({ packId: 'two', documentId: 'duplicate', term: 'два' }));
    const multi = new MultiMedicalStore([
      { moduleId: 'one', store: first, required: true },
      { moduleId: 'two', store: second },
    ]);

    await expect(multi.initialize()).rejects.toThrow('Duplicate active document ID');
  });

  it('rejects incompatible schema versions', async () => {
    const first = await store(seed({ packId: 'one', documentId: 'one', term: 'один' }));
    const second = await store(
      seed({ packId: 'two', documentId: 'two', term: 'два', schemaVersion: 3 }),
    );
    const multi = new MultiMedicalStore([
      { moduleId: 'one', store: first, required: true },
      { moduleId: 'two', store: second },
    ]);

    await expect(multi.initialize()).rejects.toThrow('Incompatible module schema versions');
  });

  it('rejects the same embedding profile ID with another fingerprint', async () => {
    const first = await store(
      seed({ packId: 'one', documentId: 'one', term: 'один', fingerprint: 'one' }),
    );
    const second = await store(
      seed({ packId: 'two', documentId: 'two', term: 'два', fingerprint: 'two' }),
    );
    const multi = new MultiMedicalStore([
      { moduleId: 'one', store: first, required: true },
      { moduleId: 'two', store: second },
    ]);

    await expect(multi.initialize()).rejects.toThrow('Incompatible embedding profile');
  });
});
