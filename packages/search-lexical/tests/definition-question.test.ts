import { describe, expect, it } from 'vitest';
import { createSqliteDefinitionReference } from '../../storage-sqlite/src/definition-reference-reader';
import { definitionQuestionSubject } from '../src/definition-question';

describe('definition question framing', () => {
  it.each([
    ['Что такое анизокория?', 'анизокория'],
    ['Что означает «ОАК»?', 'ОАК'],
    ['что значит “Термин”?', 'Термин'],
    ['Дайте определение термина «Нарушение X»', 'Нарушение X'],
    ['Покажи определение: X-Y', 'X-Y'],
    ['Определение слова «Термин»', 'Термин'],
    ['Найди термин Икота', 'Икота'],
    ['Как это называется: разный размер зрачков?', 'разный размер зрачков'],
    ['Не помню термин — кратковременное сокращение мышцы', 'кратковременное сокращение мышцы'],
    ['Что такое отсутствие восприятия запахов?', 'отсутствие восприятия запахов'],
    ['Что такое «Термин»？', 'Термин'],
  ])('extracts only the complete literal subject of %s', (query, expected) => {
    expect(definitionQuestionSubject(query)).toBe(expected);
  });

  it.each([
    '',
    'анизокория',
    'у пациента нет икоты',
    'Врач спросил что такое икота',
    'Что такое?',
    'Что такое',
    'Что такое \0икота',
    'x'.repeat(2049),
  ])('does not invent a subject for %s', (query) =>
    expect(definitionQuestionSubject(query)).toBeNull(),
  );

  it('does not discard a tail or silently resolve alternatives', () => {
    expect(definitionQuestionSubject('Что такое икота или дисфагия?')).toBe('икота или дисфагия');
    expect(definitionQuestionSubject('Что такое икота, которой сейчас нет?')).toBe(
      'икота, которой сейчас нет',
    );
    expect(definitionQuestionSubject(`Что такое ${'x'.repeat(513)}`)).toBeNull();
  });
});

function executor(literalName?: string) {
  const reads: { sql: string; args: readonly (string | number)[] }[] = [];
  const row = (id: string, title: string) => ({
    id,
    title,
    kind: 'term',
    coverage: 'definition',
    text_kind: 'source-excerpt',
    block_count: 1,
  });
  return {
    reads,
    async read(sql: string, args: readonly (string | number)[]) {
      reads.push({ sql, args });
      if (sql.includes("key = 'definition_reference'")) {
        return [
          {
            value: JSON.stringify({
              contract: 1,
              editionId: 'fixture.reference',
              publicationState: 'local-dev',
              reviewStatus: 'requires-review',
              identityStatus: 'source-local-proposed',
              linkLayout: 'numeric-v1',
            }),
          },
        ];
      }
      if (sql.includes('n.normalized_name = ?')) {
        if (literalName && args[0] === literalName) return [row('fixture.literal', literalName)];
        if (args[0] === 'икота')
          return [row('fixture.first', 'Икота'), row('fixture.second', 'Икота')];
      }
      return [];
    },
  };
}

describe('question-to-reader boundary', () => {
  it('checks raw exact identity before stripping any language framing', async () => {
    const sql = executor('что такое икота?');
    const reader = await createSqliteDefinitionReference(sql);
    const result = await reader.search('Что такое икота?');
    expect(result.map((row) => row.id)).toEqual(['fixture.literal']);
    expect(sql.reads.filter((row) => row.sql.includes('n.normalized_name = ?'))).toHaveLength(1);
    expect(sql.reads.some((row) => row.sql.includes('MATCH'))).toBe(false);
  });

  it('retains both source-local exact senses without a full-text scan', async () => {
    const sql = executor();
    const reader = await createSqliteDefinitionReference(sql);
    const result = await reader.search('Что такое «Икота»?');
    expect(result.map((row) => row.id)).toEqual(['fixture.first', 'fixture.second']);
    expect(result.every((row) => row.match === 'name')).toBe(true);
    expect(
      sql.reads
        .filter((row) => row.sql.includes('n.normalized_name = ?'))
        .map((row) => row.args[0]),
    ).toEqual(['что такое «икота»?', 'икота']);
    expect(sql.reads.some((row) => row.sql.includes('MATCH'))).toBe(false);
  });

  it('does not cut a compound description down to an attractive known term', async () => {
    const sql = executor();
    const reader = await createSqliteDefinitionReference(sql);
    await reader.search('Что такое икота при отсутствии глотания?');
    expect(
      sql.reads
        .filter((row) => row.sql.includes('n.normalized_name = ?'))
        .map((row) => row.args[0]),
    ).toEqual(['что такое икота при отсутствии глотания?', 'икота при отсутствии глотания']);
    expect(sql.reads.some((row) => row.sql.includes('definition-description'))).toBe(true);
  });
});
