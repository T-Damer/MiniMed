import { describe, expect, it, vi } from 'vitest';

import {
  createLNoteMedicalCoreAdapter,
  type LNoteChunk,
  type LNoteClient,
  type LNoteDocument,
  type LNoteSection,
} from './l-note-adapter';

const SECTION_PATH = ['Бронхиолит', 'Клиническая картина'] as const;
const SECTION_TYPE = 'clinical-picture' as const;

const CHUNK: LNoteChunk = {
  id: 'chunk-1',
  sectionId: 'section-1',
  documentVersionId: 'document-1@v1',
  orderIndex: 0,
  text: 'Свистящее дыхание у грудного ребенка требует оценки бронхиолита.',
  anchor: 'document-1@v1/clinical-picture#chunk-1',
};

const SECTION: LNoteSection = {
  id: 'section-1',
  documentVersionId: 'document-1@v1',
  title: 'Клиническая картина',
  sectionType: SECTION_TYPE,
  depth: 1,
  orderIndex: 0,
  anchor: 'document-1@v1/clinical-picture',
  path: SECTION_PATH,
  chunks: [CHUNK],
};

const DOCUMENT: LNoteDocument = {
  id: 'document-1',
  title: 'Бронхиолит у детей',
  shortTitle: 'Бронхиолит',
  sourceType: 'clinical-recommendation',
  status: 'active',
  specialties: ['pediatrics'],
  versionId: 'document-1@v1',
  versionLabel: 'v1',
  effectiveFrom: '2026-01-01',
  metadata: { source: 'l-note-fixture' },
  sections: [SECTION],
};

function fakeClient(overrides: Partial<LNoteClient> = {}): LNoteClient {
  return {
    initialize: vi.fn(async () => ({
      schemaVersion: 2,
      packIds: ['l-note.demo'],
      documentCount: 1,
    })),
    getCapabilities: vi.fn(async () => ({
      semanticSearch: true,
      embeddingProfileIds: ['l-note-hash-v1'],
      persistentStorage: true,
      storageInstallation: 'reused' as const,
      storageSizeBytes: 1024,
    })),
    listDocuments: vi.fn(async () => [DOCUMENT]),
    search: vi.fn(async () => ({
      requestId: 'request-1',
      normalizedQuery: 'грудничок свистит при дыхании',
      elapsedMs: 7,
      modeUsed: 'hybrid' as const,
      analysis: {
        normalizedQuery: 'грудничок свистит при дыхании',
        terms: ['грудничок', 'свистит', 'дыхании'],
      },
      diagnostics: {
        lexicalQuery: 'грудничок AND свистит AND дыхании',
        candidateCount: 4,
        embeddingProfileId: 'l-note-hash-v1',
      },
      hits: [
        {
          chunkId: CHUNK.id,
          documentId: DOCUMENT.id,
          documentVersionId: DOCUMENT.versionId,
          sectionId: SECTION.id,
          anchor: CHUNK.anchor,
          title: DOCUMENT.title,
          sectionPath: SECTION_PATH,
          snippet: CHUNK.text,
          score: 150,
          lexicalScore: 30,
          semanticScore: 0.8,
          matchedTerms: ['свистит', 'дыхании'],
          sectionType: SECTION_TYPE,
        },
      ],
    })),
    getDocument: vi.fn(async () => DOCUMENT),
    getSection: vi.fn(async () => SECTION),
    getContext: vi.fn(async () => ({
      document: DOCUMENT,
      section: SECTION,
      focusChunkId: CHUNK.id,
      chunks: [CHUNK],
      previousChunkId: null,
      nextChunkId: null,
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('LNoteMedicalCoreAdapter', () => {
  it('exposes an L-Note client through the MedicalCore lifecycle and capability contract', async () => {
    const client = fakeClient();
    const core = createLNoteMedicalCoreAdapter(client, { platform: 'web' });

    await expect(core.initialize()).resolves.toEqual({
      ok: true,
      value: {
        state: 'ready',
        schemaVersion: 2,
        contentPackIds: ['l-note.demo'],
        documentCount: 1,
      },
    });

    const capabilities = await core.getCapabilities();
    expect(capabilities).toMatchObject({
      ok: true,
      value: {
        semanticSearch: true,
        embeddingProfileIds: ['l-note-hash-v1'],
        localCaseExtraction: false,
        platform: 'web',
        storageBackend: 'multi-store',
      },
    });

    await core.close();
    await core.close();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('normalizes arbitrary L-Note scores, groups hits and preserves source navigation', async () => {
    const client = fakeClient();
    const core = createLNoteMedicalCoreAdapter(client);
    const response = await core.search({
      query: 'грудничок свистит при дыхании',
      mode: 'hybrid',
      filters: { specialties: ['pediatrics'] },
      limit: 5,
      includeSuggestions: false,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups).toHaveLength(1);
    const group = response.value.groups[0];
    expect(group).toBeDefined();
    if (!group) return;
    expect(group).toMatchObject({
      documentId: DOCUMENT.id,
      categories: ['clinical-picture'],
    });
    expect(group.bestScore).toBeGreaterThan(0.99);
    expect(group.bestScore).toBeLessThan(1);
    const result = group.results[0];
    expect(result).toBeDefined();
    if (!result) return;
    expect(result).toMatchObject({
      chunkId: CHUNK.id,
      anchor: CHUNK.anchor,
      semanticScore: 0.8,
      matchedTerms: ['свистит', 'дыхании'],
    });
    expect(client.search).toHaveBeenCalledWith({
      query: 'грудничок свистит при дыхании',
      mode: 'hybrid',
      filters: { specialties: ['pediatrics'] },
      limit: 5,
    });

    const context = await core.getSearchResultContext(result, 2);
    expect(context).toMatchObject({
      ok: true,
      value: {
        focusChunkId: CHUNK.id,
        section: { id: SECTION.id },
      },
    });
    expect(client.getContext).toHaveBeenCalledWith(CHUNK.id, 2);
  });

  it('provides deterministic fallback query analysis and explicit feature errors', async () => {
    const core = createLNoteMedicalCoreAdapter(fakeClient());
    const analysis = await core.analyzeQuery({
      query: '  Грудничок свистит  ',
      includeSuggestions: true,
    });

    expect(analysis).toMatchObject({
      ok: true,
      value: {
        normalizedQuery: 'грудничок свистит',
        branches: [{ id: 'l-note:original', terms: ['грудничок', 'свистит'] }],
      },
    });

    const ask = await core.ask({ query: 'что это', chunkIds: [CHUNK.id] });
    expect(ask).toEqual({
      ok: false,
      error: {
        code: 'FEATURE_DISABLED',
        message: 'The connected L-Note client has no ask API.',
      },
    });
  });

  it('maps client failures into stable LocalMed errors', async () => {
    const notFound = Object.assign(new Error('missing document'), { code: 'NOT_FOUND' as const });
    const core = createLNoteMedicalCoreAdapter(
      fakeClient({
        getDocument: vi.fn(async () => {
          throw notFound;
        }),
      }),
    );

    await expect(core.getDocument('missing')).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'CONTENT_NOT_FOUND',
        message: 'missing document',
        details: { adapter: 'l-note', operation: 'getDocument' },
      },
    });
  });
});
