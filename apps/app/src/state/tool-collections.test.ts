import { describe, expect, it } from 'vitest';

import {
  collectionIdsContainingTool,
  createToolCollection,
  deleteToolCollection,
  EMPTY_TOOL_COLLECTIONS,
  isFavoriteTool,
  loadToolCollections,
  parseToolCollections,
  renameToolCollection,
  saveToolCollections,
  setToolInCollection,
  TOOL_COLLECTIONS_KEY,
  toggleFavoriteTool,
  toolCollectionNameError,
} from './tool-collections';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[TOOL_COLLECTIONS_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const create =
  (name: string, id: string) =>
  (state = EMPTY_TOOL_COLLECTIONS) =>
    createToolCollection(state, name, { id, createdAt: '2026-09-26T10:00:00.000Z' });

describe('tool collections', () => {
  it('toggles a favourite by stable tool id and keeps insertion order', () => {
    let state = toggleFavoriteTool(EMPTY_TOOL_COLLECTIONS, 'calc.bmi');
    state = toggleFavoriteTool(state, 'assessment.phq9');
    expect(state.favorites).toEqual(['calc.bmi', 'assessment.phq9']);
    state = toggleFavoriteTool(state, 'calc.bmi');
    expect(isFavoriteTool(state, 'calc.bmi')).toBe(false);
    expect(state.favorites).toEqual(['assessment.phq9']);
  });

  it('lets one tool belong to several collections and removes it from one only', () => {
    let state = create('Приём кардиолога', 'c1')();
    state = create('Дежурство', 'c2')(state);
    state = setToolInCollection(state, 'c1', 'calc.qtc', true);
    state = setToolInCollection(state, 'c2', 'calc.qtc', true);
    state = setToolInCollection(state, 'c2', 'calc.qtc', true);
    expect([...collectionIdsContainingTool(state, 'calc.qtc')]).toEqual(['c1', 'c2']);
    expect(state.collections[1]?.toolIds).toEqual(['calc.qtc']);
    state = setToolInCollection(state, 'c1', 'calc.qtc', false);
    expect([...collectionIdsContainingTool(state, 'calc.qtc')]).toEqual(['c2']);
  });

  it('validates, renames and deletes collections', () => {
    let state = create('  Приём   кардиолога ', 'c1')();
    expect(state.collections[0]?.name).toBe('Приём кардиолога');
    expect(toolCollectionNameError(state, 'приём КАРДИОЛОГА')).toBe(
      'Коллекция с таким названием уже есть.',
    );
    expect(toolCollectionNameError(state, '   ')).toBe('Введите название коллекции.');
    expect(toolCollectionNameError(state, 'Приём кардиолога', 'c1')).toBeUndefined();
    expect(() => create('Приём кардиолога', 'c2')(state)).toThrow('уже есть');
    state = renameToolCollection(state, 'c1', 'Кардиология');
    expect(state.collections[0]?.name).toBe('Кардиология');
    state = deleteToolCollection(state, 'c1');
    expect(state.collections).toEqual([]);
  });

  it('keeps ids of tools missing from the catalog instead of dropping them', () => {
    const state = setToolInCollection(create('Старое', 'c1')(), 'c1', 'tool.removed', true);
    const storage = memoryStorage();
    saveToolCollections(state, storage);
    expect(loadToolCollections(storage).collections[0]?.toolIds).toEqual(['tool.removed']);
  });

  it('drops malformed stored entries and survives unreadable JSON', () => {
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
    expect(loadToolCollections(memoryStorage('{not json'))).toEqual(EMPTY_TOOL_COLLECTIONS);
  });
});
