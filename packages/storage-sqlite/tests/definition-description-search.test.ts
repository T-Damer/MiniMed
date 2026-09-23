import { describe, expect, it } from 'vitest';
import { createSqliteDefinitionReference } from '../src/definition-reference-reader';

const manifest = JSON.stringify({ contract: 1, editionId: 'fixture.reference',
  publicationState: 'local-dev', reviewStatus: 'requires-review',
  identityStatus: 'source-local-proposed', linkLayout: 'numeric-v1' });
const header = { id: 'fixture.correct', title: 'Тестовый термин', kind: 'symptom',
  coverage: 'definition', text_kind: 'source-excerpt', block_count: 1 };
function fixture(exact = false) {
  const statements: { sql: string; args: readonly (string | number)[] }[] = [];
  return {
    statements,
    executor: {
      async read(sql: string, args: readonly (string | number)[]) {
        statements.push({ sql, args });
        if (sql.includes("key = 'definition_reference'")) return [{ value: manifest }];
        if (exact && sql.includes('WHERE n.normalized_name')) return [header];
        if (sql.includes('definition-description')) return [
          { ...header, chunk_id: 'fixture.body', evidence: 'Объекты неравного размера.', score: -1 },
          { ...header, id: 'fixture.other', chunk_id: 'fixture.other-body', evidence: 'Объекты могут быть полезны.', score: -2 },
        ];
        return [];
      },
    },
  };
}

describe('bounded reverse definition reader', () => {
  it('does not run the inverse handler when an exact name already resolves', async () => {
    const test = fixture(true);
    const reader = await createSqliteDefinitionReference(test.executor);
    expect((await reader.search('без изменения размера'))[0]?.id).toBe(header.id);
    expect(test.statements.some((row) => row.sql.includes('definition-description'))).toBe(false);
    expect(test.statements).toHaveLength(2);
  });
  it('connects a description to actual source identities without inventing an answer', async () => {
    const test = fixture();
    const reader = await createSqliteDefinitionReference(test.executor);
    const hits = await reader.search('Как называется объект неравных размеров?');
    expect(hits.map((row) => row.id)).toEqual([header.id]);
    expect(hits[0]?.match).toBe('text');
    expect(hits[0]?.reviewStatus).toBe('requires-review');
    const branch = test.statements.filter((row) => row.sql.includes('definition-description'));
    expect(branch).toHaveLength(2);
    for (const call of branch) {
      expect(call.sql).toContain('LIMIT 96');
      expect(call.sql).toContain("l.link_type = 'reference:definition'");
      expect(call.sql).toContain('p.enabled = 1');
      expect(call.sql).toContain('substr(c.original_text, 1, 4096)');
      expect(call.args).toContain('fixture.reference');
    }
  });
  it('keeps empty-name discovery records out of description evidence', async () => {
    const test = fixture();
    const reader = await createSqliteDefinitionReference(test.executor);
    await reader.search('объекты неравного размера');
    const sql = test.statements.filter((row) => row.sql.includes('definition-description')).map((row) => row.sql).join('\n');
    expect(sql).toContain("IN ('definition','explicit-definition')");
    expect(sql).not.toContain("'reference:annotation'");
  });
  it('does not interpolate query text into SQL', async () => {
    const test = fixture();
    const reader = await createSqliteDefinitionReference(test.executor);
    await reader.search('объекты неравных размеров DROP TABLE chunks');
    expect(test.statements.every((row) => !row.sql.includes('DROP TABLE'))).toBe(true);
  });
});
