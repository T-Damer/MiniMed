import { describe, expect, it } from 'vitest';
import { createSqliteDefinitionReference } from '../src/definition-reference-reader';

const manifest = JSON.stringify({
  contract: 1,
  editionId: 'fixture.reference',
  publicationState: 'local-dev',
  reviewStatus: 'requires-review',
  identityStatus: 'source-local-proposed',
  linkLayout: 'numeric-v1',
});
const header = {
  id: 'fixture.term',
  title: 'Ксеростомия',
  kind: 'term',
  coverage: 'definition',
  text_kind: 'source-excerpt',
  block_count: 1,
};
function fixture(exact = false) {
  const statements: { sql: string; parameters: readonly (string | number)[] }[] = [];
  return {
    statements,
    executor: {
      async read(sql: string, parameters: readonly (string | number)[]) {
        statements.push({ sql, parameters });
        if (sql.includes("key = 'definition_reference'")) return [{ value: manifest }];
        if (sql.includes('n.normalized_name = ?')) return exact ? [header] : [];
        if (sql.includes('n.normalized_name IN'))
          return parameters.includes('ксеростомия') ? [header] : [];
        return [];
      },
    },
  };
}

describe('indexed dictionary spelling lookup', () => {
  it.each(['ксреостомия', 'Что такое Ксреостомия?'])(
    'retrieves a stored name before body search: %s',
    async (query) => {
      const test = fixture();
      const reader = await createSqliteDefinitionReference(test.executor);
      expect((await reader.search(query))[0]).toMatchObject({ id: header.id, match: 'name' });
      const spelling = test.statements.find((row) => row.sql.includes('n.normalized_name IN'));
      expect(spelling?.parameters).toContain('ксеростомия');
      expect(spelling?.parameters.length).toBeLessThanOrEqual(50);
      expect(spelling?.sql).toContain('p.enabled = 1');
      expect(test.statements.some((row) => row.sql.includes(' MATCH '))).toBe(false);
    },
  );
  it('keeps an existing exact identity ahead of spelling candidates', async () => {
    const test = fixture(true);
    const reader = await createSqliteDefinitionReference(test.executor);
    expect((await reader.search('ксреостомия'))[0]?.id).toBe(header.id);
    expect(test.statements).toHaveLength(2);
  });
  it.each(['АД', '12345678', 'боль', 'боль в животе'])(
    'does not issue spelling probes for %s',
    async (query) => {
      const test = fixture();
      const reader = await createSqliteDefinitionReference(test.executor);
      await reader.search(query);
      expect(test.statements.some((row) => row.sql.includes('n.normalized_name IN'))).toBe(false);
    },
  );
});
