import { DefinitionReferenceRequestSchema } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';
import { readDefinitionReferenceAnnotations } from '../src/definition-reference-annotations';

function row(index = 1): Record<string, unknown> {
  return {
    id: `reference.annotation.a${index}`,
    kind: 'etymology',
    label: 'Source wording',
    start_offset: 2,
    end_offset: 4,
    characters: 7,
    statement: '🔬a',
    chunk_id: 'reference.block.a',
    source_id: 'reference.source.a',
  };
}

const scope = { moduleId: 'fixture.module', editionId: 'fixture.edition' };

describe('source annotation read boundary', () => {
  it('admits only bounded domain requests, never arbitrary SQL', () => {
    expect(
      DefinitionReferenceRequestSchema.parse({ ...scope, op: 'annotations', id: 'fixture.term' })
        .op,
    ).toBe('annotations');
    for (const request of [
      { ...scope, op: 'annotations', id: 'fixture.term', sql: 'SELECT 1' },
      { ...scope, op: 'annotations', id: 'fixture.term', after: '../other' },
      { ...scope, op: 'annotations', id: 'fixture.term', after: 'a'.repeat(257) },
    ])
      expect(DefinitionReferenceRequestSchema.safeParse(request).success).toBe(false);
  });

  it('paginates eight entries and counts Unicode code points', async () => {
    const read = vi.fn(async () => Array.from({ length: 9 }, (_, index) => row(index + 1)));
    const page = await readDefinitionReferenceAnnotations(
      { read },
      scope.editionId,
      'fixture.term',
    );
    expect(page.items).toHaveLength(8);
    expect(page.next).toBe('reference.annotation.a8');
    expect(page.items[0]?.statement).toBe('🔬a');
    expect(page.items[0]?.identityStatus).toBe('unresolved');
    expect(read).toHaveBeenCalledWith(expect.stringContaining('LIMIT 9'), [
      'fixture.term',
      '',
      scope.editionId,
    ]);
  });

  it('keeps source and input-receipt membership checks in SQL', async () => {
    const read = vi.fn(async () => []);
    await readDefinitionReferenceAnnotations(
      { read },
      scope.editionId,
      'fixture.term',
      'reference.annotation.a2',
    );
    expect(read).toHaveBeenCalledWith(expect.stringContaining("'$.inputSha256'"), [
      'fixture.term',
      'reference.annotation.a2',
      scope.editionId,
    ]);
    expect(read.mock.calls[0]?.[0]).toContain("'reference:context'");
  });

  it('returns an empty page without fabricating an origin', async () => {
    expect(
      await readDefinitionReferenceAnnotations(
        { read: async () => [] },
        scope.editionId,
        'fixture.term',
      ),
    ).toEqual({ items: [], next: null });
  });

  it('rejects oversize adapter replies', async () => {
    await expect(
      readDefinitionReferenceAnnotations(
        { read: async () => Array.from({ length: 10 }, () => row()) },
        scope.editionId,
        'fixture.term',
      ),
    ).rejects.toThrow('bound');
  });

  for (const [field, value] of [
    ['kind', 'invented-biography'],
    ['start_offset', -1],
    ['start_offset', 1.5],
    ['end_offset', 9000],
    ['end_offset', 2],
    ['characters', 3],
    ['statement', 'x'],
    ['statement', '\0x'],
    ['label', ''],
    ['label', 'x'.repeat(257)],
    ['id', '../../outside'],
    ['chunk_id', 'https://example.com'],
    ['source_id', null],
  ] as const) {
    it(`rejects malformed ${field}: ${String(value).slice(0, 20)}`, async () => {
      const invalid = { ...row(), [field]: value };
      await expect(
        readDefinitionReferenceAnnotations(
          { read: async () => [invalid] },
          scope.editionId,
          'fixture.term',
        ),
      ).rejects.toThrow();
    });
  }
});
