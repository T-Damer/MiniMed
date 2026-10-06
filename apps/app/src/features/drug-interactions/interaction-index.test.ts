import { describe, expect, it } from 'vitest';

import {
  compareRankedDocuments,
  type InteractionIndexAsset,
  parseInteractionIndex,
  sentencesNaming,
} from './interaction-index';
import { buildFixtureIndex } from './interaction-test-fixtures';

function valid(): InteractionIndexAsset {
  return JSON.parse(JSON.stringify(buildFixtureIndex().asset)) as InteractionIndexAsset;
}

describe('parseInteractionIndex', () => {
  it('accepts what the builder writes', () => {
    expect(() => parseInteractionIndex(valid())).not.toThrow();
  });

  it('rejects an asset that is not an index', () => {
    expect(() => parseInteractionIndex(null)).toThrow(/not an object/u);
    expect(() => parseInteractionIndex({ ...valid(), schemaVersion: 2 })).toThrow(
      /schema version/u,
    );
    expect(() => parseInteractionIndex({ ...valid(), targets: ['x:bad'] })).toThrow(/malformed/u);
  });

  it('rejects an index that points outside its own tables', () => {
    const asset = valid();
    const [id] = Object.keys(asset.documents);
    const document = asset.documents[id ?? ''];
    const broken = {
      ...asset,
      documents: {
        ...asset.documents,
        [id ?? '']: { ...document, sp: [[0, 0, 5, 1, 99_999]] },
      },
    };
    expect(() => parseInteractionIndex(broken)).toThrow(/index outside/u);
    const badModule = {
      ...asset,
      documents: { ...asset.documents, [id ?? '']: { ...document, m: 40 } },
    };
    expect(() => parseInteractionIndex(badModule)).toThrow(/no module/u);
    const badRange = {
      ...asset,
      documents: { ...asset.documents, [id ?? '']: { ...document, sp: [[0, 9, 3, 1, 0]] } },
    };
    expect(() => parseInteractionIndex(badRange)).toThrow(/invalid sentence range/u);
  });
});

describe('ranking and lookup', () => {
  it('reads an instruction with an interaction section first, a ГРЛС file before a holder’s site', () => {
    const base = { id: 'b', x: 1, s: 0, k: 1 };
    expect(compareRankedDocuments({ ...base, id: 'a', x: 0 }, base)).toBeGreaterThan(0);
    expect(compareRankedDocuments({ ...base, s: 1 }, base)).toBeGreaterThan(0);
    expect(compareRankedDocuments({ ...base, k: 3 }, base)).toBeGreaterThan(0);
    expect(compareRankedDocuments({ ...base, k: 0 }, base)).toBeLessThan(0);
  });

  it('lists the sentences of a document that name a target, with full section ids', () => {
    const index = buildFixtureIndex();
    const warfarin = index.documentsOfCard.get(index.cardBySlug.get('варфарин') ?? -1)?.[0] ?? '';
    const ibuprofenTarget = index.asset.targets.indexOf('s:ибупрофен');
    const found = sentencesNaming(index, warfarin, new Set([ibuprofenTarget]));
    expect(found).toHaveLength(1);
    expect(found[0]?.section[0]).toBe('section.1111111111111111');
    expect(sentencesNaming(index, warfarin, new Set([9_999]))).toEqual([]);
    expect(sentencesNaming(index, 'drug.rf.unknown.instruction', new Set([0]))).toEqual([]);
  });
});
