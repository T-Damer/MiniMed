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

function reader(row: Record<string, unknown>) {
  return createSqliteDefinitionReference({
    async read(sql) {
      if (sql.includes("key = 'definition_reference'")) return [{ value: manifest }];
      if (sql.includes('FROM knowledge_entities e WHERE e.id = ?')) return [row];
      return [];
    },
  });
}

const header = {
  id: 'fixture.term',
  title: 'Депрессия',
  kind: 'term',
  coverage: 'explicit-definition',
  text_kind: 'source-excerpt',
  block_count: 1,
};

describe('definition reference sense signals', () => {
  it('returns the ranking signals of an edition built with senses', async () => {
    const sense = {
      field: 'psychiatry',
      fieldLabel: 'психиатрия',
      documents: 2,
      meaning: 1,
      authority: 1,
      usage: 68,
      termUsage: 275,
    };
    const card = await (await reader({ ...header, sense_json: JSON.stringify(sense) })).getCard(
      'fixture.term',
    );
    expect(card?.sense).toEqual(sense);
  });

  it('has no signals for an edition built before senses', async () => {
    const card = await (await reader({ ...header, sense_json: null })).getCard('fixture.term');
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('sense');
  });

  it('rejects malformed signals instead of ranking on them', async () => {
    const broken = JSON.stringify({ usage: -1 });
    await expect(
      (await reader({ ...header, sense_json: broken })).getCard('fixture.term'),
    ).rejects.toThrow('Invalid reference row integer');
  });
});
