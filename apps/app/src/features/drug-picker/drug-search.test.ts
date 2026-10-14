import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkedWithDirectory,
  directoryExtras,
  drugDirectoryGroups,
  withDirectoryGroups,
} from './drug-search';

const group = (documentId: string, title = documentId): SearchResultGroup => ({
  documentId,
  title,
  bestScore: 1,
  categories: [],
  results: [],
});
const POINTER = (slug: string) =>
  `core.catalog.pointer.medication.esklp.mnn.${slug}-0123456789abcdef`;

describe('the cards a drug picker adds to the search', () => {
  const searched = [group(POINTER('валсартан')), group('drug.rf.123.instruction'), group('other')];
  const directory = [group('esklp.mnn.валсартан'), group('esklp.mnn.валсартан-сакубитрил')];

  it('keeps only the cards whose substance the search did not return', () => {
    expect(directoryExtras(searched, directory).map((item) => item.documentId)).toEqual([
      'esklp.mnn.валсартан-сакубитрил',
    ]);
    expect(directoryExtras([], directory)).toHaveLength(2);
  });

  it('appends them to a suggestion list, or puts them right behind the groups a resolver checks', () => {
    expect(withDirectoryGroups(searched, directory).map((item) => item.documentId)).toEqual([
      ...searched.map((item) => item.documentId),
      'esklp.mnn.валсартан-сакубитрил',
    ]);
    expect(withDirectoryGroups(searched, [group('esklp.mnn.валсартан')])).toBe(searched);
    expect(checkedWithDirectory(searched, directory, 2).map((item) => item.documentId)).toEqual([
      POINTER('валсартан'),
      'drug.rf.123.instruction',
      'esklp.mnn.валсартан-сакубитрил',
    ]);
  });
});

describe('the shipped drug names (SRCH1, item 4)', () => {
  it('find a combination by one component, in any order, and a card by its trade name', async () => {
    const [bySacubitril, reordered, bySlash] = await Promise.all([
      drugDirectoryGroups('сакубитрил'),
      drugDirectoryGroups('сакубитрил валсартан'),
      drugDirectoryGroups('сакубитрил/валсартан'),
    ]);
    for (const found of [bySacubitril, reordered, bySlash]) {
      expect(found[0]?.documentId).toBe('esklp.mnn.валсартан-сакубитрил');
    }
    const aspirin = await drugDirectoryGroups('Аспирин');
    expect(aspirin[0]?.title).toMatch(/^Аспирин · АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА$/u);
    expect(aspirin[0]?.documentId).toBe('esklp.mnn.ацетилсалициловая-кислота');
    expect(await drugDirectoryGroups('<script>alert(1)</script>')).toEqual([]);
  });
});
