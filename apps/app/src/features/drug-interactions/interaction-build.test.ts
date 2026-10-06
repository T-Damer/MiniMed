import { describe, expect, it } from 'vitest';

import { buildFixtureIndex } from './interaction-test-fixtures';

describe('the interaction index builder', () => {
  const index = buildFixtureIndex();
  const targetNames = index.asset.targets;
  const namesOf = (documentId: string): readonly string[] =>
    (index.asset.documents[documentId]?.sp ?? []).flatMap((span) =>
      span.slice(4).map((target) => targetNames[target] ?? '?'),
    );

  it('records the substances a sentence names, not the instruction’s own substance', () => {
    const warfarin = namesOf('drug.rf.aaaa.instruction');
    expect(warfarin).toContain('s:омепразол');
    expect(warfarin).toContain('s:ибупрофен');
    expect(warfarin).not.toContain('s:варфарин');
    const ibuprofen = namesOf('drug.rf.bbbb.instruction');
    expect(ibuprofen).toContain('s:варфарин');
    expect(ibuprofen).toContain('s:ацетилсалицил кислот');
    expect(ibuprofen).not.toContain('s:ибупрофен');
  });

  it('reads a class by its official name and an everyday name of a substance by alias', () => {
    const warfarin = namesOf('drug.rf.aaaa.instruction');
    expect(warfarin).toContain('c:M01A');
    expect(warfarin).toContain('s:этанол');
  });

  it('does not take the own class of an instruction for an interaction outside its interaction section', () => {
    const special = (index.asset.documents['drug.rf.bbbb.instruction']?.sp ?? []).filter(
      (span) => span[3] === 2,
    );
    expect(special).toHaveLength(0);
  });

  it('keeps no instruction text, only offsets and a checksum', () => {
    const serialized = JSON.stringify(index.asset);
    expect(serialized).not.toContain('Усиление антикоагулянтного');
    expect(serialized).not.toContain('кровотечений');
    for (const document of Object.values(index.asset.documents)) {
      for (const [id, checksum] of document.sec) {
        expect(id).toMatch(/^[0-9a-f]+$/u);
        expect(checksum).toMatch(/^[0-9a-f]{4}$/u);
      }
    }
  });

  it('links a document to its card through the registration number', () => {
    const warfarinCard = index.cardBySlug.get('варфарин');
    expect(warfarinCard).toBeDefined();
    expect(index.documentsOfCard.get(warfarinCard ?? -1)).toEqual(['drug.rf.aaaa.instruction']);
  });
});
