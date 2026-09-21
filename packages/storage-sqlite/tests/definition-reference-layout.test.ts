import { describe, expect, it } from 'vitest';
import { createSqliteDefinitionReference } from '../src/definition-reference-reader';

function executor(layout?: unknown) {
  const statements: string[] = [];
  const manifest = {
    contract: 1,
    editionId: 'fixture.reference',
    publicationState: 'local-dev',
    reviewStatus: 'requires-review',
    identityStatus: 'source-local-proposed',
    ...(layout === undefined ? {} : { linkLayout: layout }),
  };
  return {
    statements,
    sql: {
      async read(sql: string, _parameters: readonly (string | number)[]) {
        statements.push(sql);
        return sql.includes("key = 'definition_reference'")
          ? [{ value: JSON.stringify(manifest) }]
          : [];
      },
    },
  };
}

describe('definition reference layout dispatch', () => {
  it('keeps pre-migration legacy packs readable without a compact view', async () => {
    const fixture = executor();
    const reader = await createSqliteDefinitionReference(fixture.sql);
    await reader.listBlocks('fixture.term');
    await reader.readBlock('fixture.term', 'fixture.block');
    expect(
      fixture.statements.slice(1).every((sql) => sql.includes('knowledge_document_links')),
    ).toBe(true);
    expect(fixture.statements.join('\n')).not.toContain('definition_reference_links');
  });

  it('uses only the declared compact view and does not open another database', async () => {
    const fixture = executor('numeric-v1');
    const reader = await createSqliteDefinitionReference(fixture.sql);
    await reader.listBlocks('fixture.term');
    await reader.readBlock('fixture.term', 'fixture.block');
    expect(
      fixture.statements.slice(1).every((sql) => sql.includes('definition_reference_links')),
    ).toBe(true);
    expect(fixture.statements).toHaveLength(3);
  });

  it.each(['unknown-v2', '', null, 1, {}, 'knowledge_document_links; DROP TABLE chunks'])(
    'rejects undeclared storage layout %j before executing a source query',
    async (layout) => {
      const fixture = executor(layout);
      await expect(createSqliteDefinitionReference(fixture.sql)).rejects.toThrow('layout');
      expect(fixture.statements).toHaveLength(1);
    },
  );
});
