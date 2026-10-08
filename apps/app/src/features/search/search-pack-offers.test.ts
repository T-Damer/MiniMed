import { describe, expect, it } from 'vitest';

import { packOfferOwners } from '@/features/search/search-pack-offers';

describe('packOfferOwners', () => {
  it('gives each pack one owner: its first result', () => {
    const modules: Record<string, string> = {
      a1: 'pack-a',
      b1: 'pack-b',
      a2: 'pack-a',
      a3: 'pack-a',
    };
    const owners = packOfferOwners(['a1', 'plain', 'b1', 'a2', 'a3'], (id) => modules[id]);
    expect([...owners]).toEqual([
      ['pack-a', 'a1'],
      ['pack-b', 'b1'],
    ]);
  });
});
