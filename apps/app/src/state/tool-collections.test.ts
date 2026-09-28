import { describe, expect, it } from 'vitest';

import { EMPTY_TOOL_COLLECTIONS, parseToolCollections } from './tool-collections';

describe('version-1 tool collections', () => {
  it('drops malformed stored entries and keeps valid ones in order', () => {
    const parsed = parseToolCollections({
      version: 1,
      favorites: ['a', 'a', 7, '', 'b'],
      collections: [
        { id: 'c1', name: 'Ок', toolIds: ['x', 'x', null], createdAt: 't' },
        { id: 'c1', name: 'Дубликат', toolIds: [], createdAt: 't' },
        { id: 'c2', name: '   ', toolIds: [], createdAt: 't' },
        { name: 'Без id', toolIds: [], createdAt: 't' },
      ],
    });
    expect(parsed.favorites).toEqual(['a', 'b']);
    expect(parsed.collections).toEqual([{ id: 'c1', name: 'Ок', toolIds: ['x'], createdAt: 't' }]);
    expect(parseToolCollections({ version: 2, favorites: ['a'] })).toEqual(EMPTY_TOOL_COLLECTIONS);
  });
});
