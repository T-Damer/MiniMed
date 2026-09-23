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
  title: 'Термин',
  kind: 'term',
  coverage: 'definition',
  text_kind: 'source-excerpt',
  block_count: 2,
};
function fixture(passages: readonly string[], exactName = '', partialName = false) {
  const statements: string[] = [];
  return {
    statements,
    executor: {
      async read(sql: string, args: readonly (string | number)[]) {
        statements.push(sql);
        if (sql.includes("key = 'definition_reference'")) return [{ value: manifest }];
        if (sql.includes('WHERE n.normalized_name')) return args[0] === exactName ? [header] : [];
        if (sql.includes('FROM knowledge_fts')) return partialName ? [header] : [];
        if (sql.includes('definition-description'))
          return passages.map((evidence, index) => ({
            ...header,
            evidence,
            chunk_id: `fixture.body.${index}`,
            score: -1,
          }));
        if (sql.includes('WITH matches AS MATERIALIZED')) return [header];
        return [];
      },
    },
  };
}

describe('definition search reliability boundaries', () => {
  it.each(['Что такое «Термин»?', 'Дай определение термина Термин', 'Что означает Термин?'])(
    'resolves a framed exact name without full text: %s',
    async (query) => {
      const test = fixture([], 'термин');
      const reader = await createSqliteDefinitionReference(test.executor);
      expect((await reader.search(query))[0]?.match).toBe('name');
      expect(test.statements).toHaveLength(3);
    },
  );
  it.each(['запахи ощущаются', 'запахи не ощущаются'])(
    'does not return rejected opposite-polarity evidence through another fallback: %s',
    async (query) => {
      const passage = query.includes(' не ') ? 'Запахи ощущаются.' : 'Запахи не ощущаются.';
      const test = fixture([passage]);
      const reader = await createSqliteDefinitionReference(test.executor);
      expect(await reader.search(query)).toEqual([]);
      expect(test.statements.some((sql) => sql.includes('LIMIT 80'))).toBe(false);
    },
  );
  it('does not fill an explicit-absence result from an unverified partial title', async () => {
    const test = fixture(['Запахи ощущаются.'], '', true);
    const reader = await createSqliteDefinitionReference(test.executor);
    expect(await reader.search('как называется когда запахи не ощущаются', 1)).toEqual([]);
  });
  it('keeps a complete later passage instead of truncating the concatenated identity', async () => {
    const test = fixture(['Текст '.repeat(680), 'Объекты неравного размера.']);
    const reader = await createSqliteDefinitionReference(test.executor);
    expect((await reader.search('объекты неравных размеров'))[0]?.id).toBe(header.id);
  });
  it('does not join incomplete passages into a fabricated complete match', async () => {
    const test = fixture(['Красный объект.', 'Длинный круглый.']);
    const reader = await createSqliteDefinitionReference(test.executor);
    expect(await reader.search('красный длинный круглый объект')).toEqual([]);
  });
  it.each(['что за термин', 'как называется?', 'не помню название'])(
    'does not retrieve unrelated articles for empty navigation: %s',
    async (query) => {
      const test = fixture([]);
      const reader = await createSqliteDefinitionReference(test.executor);
      expect(await reader.search(query)).toEqual([]);
      expect(test.statements.some((sql) => sql.includes('FROM knowledge_fts'))).toBe(false);
    },
  );
});
