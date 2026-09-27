import { describe, expect, it } from 'vitest';
import { createSqliteDefinitionReference } from '../src/definition-reference-reader';

function executor(
  metadataLayout?: unknown,
  linkLayout: unknown = 'numeric-v1',
  metadata: unknown = '{}',
  publicationState: unknown = 'local-dev',
) {
  const statements: string[] = [];
  const manifest = {
    contract: 1,
    editionId: 'fixture.reference',
    publicationState,
    reviewStatus: 'requires-review',
    identityStatus: 'source-local-proposed',
    ...(linkLayout === 'legacy' ? {} : { linkLayout }),
    ...(metadataLayout === undefined ? {} : { metadataLayout }),
  };
  return {
    statements,
    sql: {
      async read(sql: string, _parameters: readonly (string | number)[]) {
        statements.push(sql);
        if (sql.includes("key = 'definition_reference'"))
          return [{ value: JSON.stringify(manifest) }];
        if (sql.includes('AS body'))
          return [{ body: 'x', characters: 1, metadata, document_id: 'fixture.source' }];
        return [];
      },
    },
  };
}

describe('reference publication state', () => {
  it('opens local-dev and experimental-preview editions and refuses anything else', async () => {
    for (const state of ['local-dev', 'experimental-preview']) {
      await expect(
        createSqliteDefinitionReference(executor(undefined, 'numeric-v1', '{}', state).sql),
      ).resolves.toBeDefined();
    }
    for (const state of ['published', 'reviewed', null]) {
      await expect(
        createSqliteDefinitionReference(executor(undefined, 'numeric-v1', '{}', state).sql),
      ).rejects.toThrow('Unsupported definition reference contract.');
    }
  });
});

describe('reference metadata layout capability', () => {
  it('does not reference metadata tables in legacy or numeric-only reads', async () => {
    for (const linkLayout of ['legacy', 'numeric-v1']) {
      const fixture = executor(undefined, linkLayout);
      const reader = await createSqliteDefinitionReference(fixture.sql);
      await reader.readBlock('fixture.term', 'fixture.block');
      expect(fixture.statements.join('\n')).not.toContain('definition_reference_chunks');
      expect(fixture.statements[1]).toContain('FROM chunks c');
    }
  });

  it('decodes only the requested block, never source metadata during search/listing', async () => {
    const original = {
      definitionReference: 1,
      nested: { literal: null, text: 'Exact source locator' },
    };
    const fixture = executor('fragments-v1', 'numeric-v1', JSON.stringify(original));
    const reader = await createSqliteDefinitionReference(fixture.sql);
    await reader.search('missing title');
    await reader.listBlocks('fixture.term');
    expect(fixture.statements.join('\n')).not.toContain('definition_reference_chunks');
    const block = await reader.readBlock('fixture.term', 'fixture.block');
    expect(block?.provenance).toEqual(original);
    expect(fixture.statements.at(-1)).toContain('FROM definition_reference_chunks c');
    expect(fixture.statements.at(-1)).toContain('e.id = ? AND c.id = ?');
    expect(fixture.statements.at(-1)).toContain('substr(c.metadata_json, 1, 65537)');
  });

  it.each(['unknown', '', null, false, 1, {}, 'chunks; DROP TABLE chunks'])(
    'rejects unrecognized metadata layout %j before any source query',
    async (layout) => {
      const fixture = executor(layout);
      await expect(createSqliteDefinitionReference(fixture.sql)).rejects.toThrow('metadata layout');
      expect(fixture.statements).toHaveLength(1);
    },
  );

  it('requires numeric keys for fragment metadata', async () => {
    const fixture = executor('fragments-v1', 'legacy');
    await expect(createSqliteDefinitionReference(fixture.sql)).rejects.toThrow();
    expect(fixture.statements).toHaveLength(1);
  });

  it.each([null, '{"$p":1}', 'not JSON'])(
    'never returns unresolved metadata %j as a source citation',
    async (metadata) => {
      const fixture = executor('fragments-v1', 'numeric-v1', metadata);
      const reader = await createSqliteDefinitionReference(fixture.sql);
      await expect(reader.readBlock('fixture.term', 'fixture.block')).rejects.toThrow();
    },
  );

  it('also rejects a storage marker in a falsely declared legacy edition', async () => {
    const fixture = executor(undefined, 'numeric-v1', '{"$p":1}');
    const reader = await createSqliteDefinitionReference(fixture.sql);
    await expect(reader.readBlock('fixture.term', 'fixture.block')).rejects.toThrow('metadata');
  });
});

describe('reference record types', () => {
  it('passes the stored entity type and text kind through unchanged', async () => {
    const manifest = {
      contract: 1,
      editionId: 'fixture.reference',
      publicationState: 'experimental-preview',
      reviewStatus: 'requires-review',
      identityStatus: 'source-local-proposed',
      linkLayout: 'numeric-v1',
    };
    const rows = [
      // An abbreviation expansion and a dictionary gloss: the UI tells them apart by these fields.
      { id: 'fixture.abbrev', title: 'АД', kind: 'abbreviation', coverage: 'abbreviation' },
      {
        id: 'fixture.gloss',
        title: 'ад',
        kind: 'term',
        coverage: 'gloss',
        text_kind: 'source-gloss',
      },
    ].map((row) => ({ text_kind: 'source-excerpt', block_count: 2, tier: 0, ...row }));
    const reader = await createSqliteDefinitionReference({
      async read(sql: string) {
        if (sql.includes("key = 'definition_reference'"))
          return [{ value: JSON.stringify(manifest) }];
        return sql.includes('n.normalized_name') ? rows : [];
      },
    });
    const hits = await reader.search('АД');
    expect(hits.map((hit) => [hit.id, hit.kind, hit.textKind, hit.coverage])).toEqual([
      ['fixture.abbrev', 'abbreviation', 'source-excerpt', 'abbreviation'],
      ['fixture.gloss', 'term', 'source-gloss', 'gloss'],
    ]);
  });
});
