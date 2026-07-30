import { describe, expect, it } from 'vitest';

import { ContentPackSeedSchema } from './content-pack';

const basePack = {
  manifest: {
    id: 'demo-pack',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Demo knowledge pack',
    checksum: 'sha256:demo',
    builtAt: '2026-07-30T00:00:00Z',
  },
  documents: [
    {
      id: 'doc-1',
      title: 'Reference',
      sourceType: 'reference',
      status: 'active',
      version: {
        id: 'doc-1-v1',
        label: '1',
        sourceChecksum: 'sha256:source',
        extractedAt: '2026-07-30T00:00:00Z',
      },
      sections: [
        {
          id: 'section-1',
          title: 'Terms',
          normalizedTitle: 'terms',
          depth: 1,
          orderIndex: 0,
          anchor: 'terms',
          sectionPath: ['Terms'],
          chunks: [
            {
              id: 'chunk-1',
              orderIndex: 0,
              originalText: 'LKB means local knowledge base.',
              normalizedText: 'lkb means local knowledge base',
              anchor: 'terms:0',
            },
          ],
        },
      ],
    },
  ],
};

describe('ContentPackSeedSchema', () => {
  it('keeps legacy document-only packs valid', () => {
    const result = ContentPackSeedSchema.parse(basePack);

    expect(result.entities).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.claimLinks).toEqual([]);
  });

  it('accepts evidence-linked entities, claims and relations', () => {
    const result = ContentPackSeedSchema.parse({
      ...basePack,
      entities: [
        {
          id: 'entity-lkb',
          type: 'concept',
          canonicalName: 'Local knowledge base',
          aliases: ['LKB'],
        },
      ],
      claims: [
        {
          id: 'claim-lkb-expansion',
          subjectEntityId: 'entity-lkb',
          predicate: 'abbreviation_expands_to',
          value: 'Local knowledge base',
          sourceKind: 'reference',
          evidence: [
            {
              documentId: 'doc-1',
              sectionId: 'section-1',
              chunkId: 'chunk-1',
              quote: 'LKB means local knowledge base.',
              anchor: 'terms:0',
            },
          ],
        },
      ],
    });

    expect(result.entities[0]?.aliases).toEqual(['LKB']);
    expect(result.claims[0]?.evidence[0]?.chunkId).toBe('chunk-1');
  });

  it('rejects claims without evidence', () => {
    expect(() =>
      ContentPackSeedSchema.parse({
        ...basePack,
        claims: [
          {
            id: 'unsupported',
            subjectEntityId: 'entity-lkb',
            predicate: 'unknown',
            sourceKind: 'computed',
            evidence: [],
          },
        ],
      }),
    ).toThrow();
  });
});
