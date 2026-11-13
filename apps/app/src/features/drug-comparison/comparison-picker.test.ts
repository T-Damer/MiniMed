import { describe, expect, it } from 'vitest';

import { loadAtcNames } from '@/features/medications/atc-names';
import { loadComparisonIndex } from './comparison-load';
import { cardTitle, drugGroupOf, sameGroupSuggestions } from './comparison-picker';

// SRCHDRUG1: the comparison's picker names each drug's ATC group and, before typing, offers the
// drugs of the chosen drug's group, read from the shipped comparison index and the NSI «АТХ» names.
describe('the comparison drug picker', () => {
  it('names a drug by its level-4 ATC group', async () => {
    const [index, names] = await Promise.all([loadComparisonIndex(), loadAtcNames()]);
    const at = index.cardBySlug.get('кветиапин');
    const card = at === undefined ? undefined : index.asset.cards[at];
    expect(card).toBeDefined();
    if (!card) return;
    expect(cardTitle(card)).toBe('Кветиапин');
    expect(drugGroupOf(card, names)).toEqual({
      code: 'N05AH',
      name: 'Диазепины, оксазепины, тиазепины и оксепины',
    });
    expect(drugGroupOf(card, null)).toBeNull();
  });

  it('offers the same group, widened to level 3 when level 4 is small', async () => {
    const [index, names] = await Promise.all([loadComparisonIndex(), loadAtcNames()]);
    const at = index.cardBySlug.get('кветиапин') ?? -1;
    const suggestions = sameGroupSuggestions(index, [at], names);
    expect(suggestions?.group).toEqual({ code: 'N05A', name: 'Антипсихотические средства' });
    const slugs = (suggestions?.cards ?? []).map((card) => index.asset.cards[card]?.s);
    // The level-4 neighbours first, then the other antipsychotics.
    expect(slugs.slice(0, 3).toSorted()).toEqual(['клозапин', 'кветиапин', 'оланзапин'].toSorted());
    expect(slugs).toContain('галоперидол');
    expect(slugs.length).toBeLessThanOrEqual(24);
  });

  it('keeps to level 4 when it is large enough', async () => {
    const [index, names] = await Promise.all([loadComparisonIndex(), loadAtcNames()]);
    const at = index.cardBySlug.get('сертралин') ?? -1;
    const suggestions = sameGroupSuggestions(index, [at], names);
    expect(suggestions?.group.code).toBe('N06AB');
    const slugs = (suggestions?.cards ?? []).map((card) => index.asset.cards[card]?.s);
    expect(slugs).toContain('флуоксетин');
    expect(slugs).not.toContain('амитриптилин');
  });

  it('offers nothing without a chosen drug', async () => {
    const [index, names] = await Promise.all([loadComparisonIndex(), loadAtcNames()]);
    expect(sameGroupSuggestions(index, [], names)).toBeNull();
  });
});
