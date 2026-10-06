import { describe, expect, it } from 'vitest';

import {
  ALCOHOL_ITEM_ID,
  checkAllPairs,
  checkPair,
  type DrugItem,
  itemDocumentId,
  itemTargets,
} from './interaction-check';
import { buildFixtureIndex } from './interaction-test-fixtures';

const index = buildFixtureIndex();
const drug = (slug: string): DrugItem => ({
  id: slug,
  kind: 'drug',
  card: index.cardBySlug.get(slug) ?? -1,
  label: slug,
});
const alcohol: DrugItem = { id: ALCOHOL_ITEM_ID, kind: 'alcohol', card: null, label: 'Алкоголь' };

describe('checkPair', () => {
  it('finds the sentences of each instruction that name the other drug', () => {
    const pair = checkPair(index, drug('варфарин'), drug('ибупрофен'));
    expect(pair.aReadsB.sentences).toHaveLength(1);
    expect(pair.bReadsA.sentences).toHaveLength(1);
    expect(pair.found).toBe(2);
  });

  it('finds a drug through its class too', () => {
    // The warfarin text names «нестероидные противовоспалительные»: ibuprofen is in M01A.
    const targets = itemTargets(index, drug('ибупрофен'));
    expect(targets.has(index.asset.targets.indexOf('c:M01A'))).toBe(true);
    expect(targets.has(index.asset.targets.indexOf('s:ибупрофен'))).toBe(true);
  });

  it('says nothing when the other drug is not named', () => {
    const pair = checkPair(index, drug('ацетилсалициловая-кислота'), drug('омепразол'));
    expect(pair.found).toBe(0);
    expect(pair.aReadsB.documentId).not.toBeNull();
    expect(pair.bReadsA.documentId).toBeNull();
  });

  it('finds alcohol in an instruction, and reads no instruction for alcohol itself', () => {
    const pair = checkPair(index, drug('варфарин'), alcohol);
    expect(pair.aReadsB.sentences.length).toBeGreaterThan(0);
    expect(pair.bReadsA.documentId).toBeNull();
    expect(itemDocumentId(index, alcohol)).toBeNull();
  });

  it('checks every unordered pair once', () => {
    const pairs = checkAllPairs(index, [drug('варфарин'), drug('ибупрофен'), alcohol]);
    expect(pairs.map((pair) => `${pair.a.id}+${pair.b.id}`)).toEqual([
      'варфарин+ибупрофен',
      `варфарин+${ALCOHOL_ITEM_ID}`,
      `ибупрофен+${ALCOHOL_ITEM_ID}`,
    ]);
  });
});
