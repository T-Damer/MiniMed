import { describe, expect, it } from 'vitest';

import { searchIndexIsConsistent } from './module-search-index';

describe('searchIndexIsConsistent', () => {
  it('requires one index row per chunk in a searchable module', () => {
    expect(searchIndexIsConsistent({ searchable: true, chunkCount: 10, ftsRowCount: 10 })).toBe(
      true,
    );
    expect(searchIndexIsConsistent({ searchable: true, chunkCount: 10, ftsRowCount: 9 })).toBe(
      false,
    );
    expect(searchIndexIsConsistent({ searchable: true, chunkCount: 10, ftsRowCount: 0 })).toBe(
      false,
    );
  });

  it('accepts an empty index only in a module that declares no search', () => {
    expect(searchIndexIsConsistent({ searchable: false, chunkCount: 799, ftsRowCount: 0 })).toBe(
      true,
    );
    expect(searchIndexIsConsistent({ searchable: false, chunkCount: 799, ftsRowCount: 3 })).toBe(
      false,
    );
  });
});
