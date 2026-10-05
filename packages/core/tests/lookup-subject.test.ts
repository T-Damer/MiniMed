import { ContentPackSeedSchema } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { InMemoryMedicalStore } from '@localmed/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { createMedicalCore } from '../src/create-medical-core';

// Synthetic source text: these fixtures test lexical matching rules, not clinical claims.
function doc(id: string, title: string, text: string) {
  return {
    id,
    title,
    shortTitle: title,
    sourceType: 'medical_reference',
    status: 'active',
    specialties: [],
    metadata: {},
    version: {
      id: `${id}@1`,
      label: '1',
      effectiveFrom: null,
      effectiveTo: null,
      sourceChecksum: `test:${id}`,
      extractedAt: '2026-10-05T00:00:00Z',
    },
    sections: [
      {
        id: `${id}.section`,
        parentSectionId: null,
        title: 'Описание',
        normalizedTitle: 'описание',
        sectionType: 'definition',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: `${id}/definition`,
        sectionPath: ['Описание'],
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

const open: ReturnType<typeof createMedicalCore>[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((core) => core.close()));
});

async function lookup(query: string) {
  const core = createMedicalCore({
    store: new InMemoryMedicalStore(),
    platform: 'test',
    seed: ContentPackSeedSchema.parse({
      manifest: {
        id: 'test.lookup-subject',
        version: '1',
        schemaVersion: 2,
        title: 'Lookup subject fixture',
        checksum: 'test-lookup-subject',
        builtAt: '2026-10-05T00:00:00Z',
      },
      documents: [
        doc('tablet', 'Амброксол таблетки', 'Амброксол таблетки покрытые оболочкой.'),
        doc('head', 'Травма головы', 'Травма головы, таблетки не применяются.'),
        doc('hemlock', 'Болиголов пятнистый', 'Болиголов пятнистый, настойка.'),
        doc('back', 'Боли в спине', 'Боли в спине при нагрузке.'),
      ],
      aliases: [],
      embeddingProfiles: [],
      embeddings: [],
    }),
  });
  open.push(core);
  await core.initialize();
  const result = await core.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.groups.map((group) => group.documentId);
}

describe('lookup subject words', () => {
  it('drops a document that shares only a form word with the query', async () => {
    const ids = await lookup('таблетки от головы');
    expect(ids).toContain('head');
    expect(ids).not.toContain('tablet');
  });

  it('keeps form-word matches when the query has no subject word', async () => {
    expect(await lookup('таблетки')).toContain('tablet');
  });

  it('does not count a short query word found inside a longer word', async () => {
    const ids = await lookup('от боли');
    expect(ids).toContain('back');
    expect(ids).not.toContain('hemlock');
  });
});
