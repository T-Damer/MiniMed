import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectionIdsContaining,
  collectionNameError,
  createCollection,
  deleteCollection,
  EMPTY_ITEM_COLLECTIONS,
  ITEM_COLLECTIONS_KEY,
  isFavoriteItem,
  loadItemCollections,
  parseItemCollections,
  renameCollection,
  saveItemCollections,
  setItemInCollection,
  toggleFavoriteItem,
} from './item-collections';
import { TOOL_COLLECTIONS_KEY } from './tool-collections';

const AT = '2026-09-28T10:00:00.000Z';
const tool = (id: string) => ({ kind: 'tool' as const, id });
const medication = {
  kind: 'document' as const,
  id: 'drug.allmed.3324',
  title: 'Амоксициллин+клавулановая кислота',
  documentKind: 'medication',
};

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const create =
  (name: string, id: string) =>
  (state = EMPTY_ITEM_COLLECTIONS) =>
    createCollection(state, name, { id, createdAt: AT });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item collections', () => {
  it('toggles favourites of any kind by stable id and keeps insertion order', () => {
    let state = toggleFavoriteItem(EMPTY_ITEM_COLLECTIONS, tool('calc.bmi'), AT);
    state = toggleFavoriteItem(state, medication, AT);
    expect(state.favorites.map((item) => [item.kind, item.id])).toEqual([
      ['tool', 'calc.bmi'],
      ['document', 'drug.allmed.3324'],
    ]);
    // A document keeps its title snapshot and kind for display when it leaves the catalog.
    expect(state.favorites[1]).toMatchObject({
      title: medication.title,
      documentKind: 'medication',
    });
    // The same id in another kind is a different item.
    expect(isFavoriteItem(state, { kind: 'document', id: 'calc.bmi' })).toBe(false);
    state = toggleFavoriteItem(state, tool('calc.bmi'), AT);
    expect(isFavoriteItem(state, tool('calc.bmi'))).toBe(false);
  });

  it('lets one item belong to several collections and removes it from one only', () => {
    let state = create('Приём кардиолога', 'c1')();
    state = create('Дежурство', 'c2')(state);
    state = setItemInCollection(state, 'c1', medication, true, AT);
    state = setItemInCollection(state, 'c2', medication, true, AT);
    state = setItemInCollection(state, 'c2', medication, true, AT);
    expect([...collectionIdsContaining(state, medication)]).toEqual(['c1', 'c2']);
    expect(state.collections[1]?.items).toHaveLength(1);
    state = setItemInCollection(state, 'c1', medication, false, AT);
    expect([...collectionIdsContaining(state, medication)]).toEqual(['c2']);
  });

  it('validates, renames and deletes collections', () => {
    let state = create('  Приём   кардиолога ', 'c1')();
    expect(state.collections[0]?.name).toBe('Приём кардиолога');
    expect(collectionNameError(state, 'приём КАРДИОЛОГА')).toBe(
      'Коллекция с таким названием уже есть.',
    );
    expect(collectionNameError(state, '   ')).toBe('Введите название коллекции.');
    expect(collectionNameError(state, 'Приём кардиолога', 'c1')).toBeUndefined();
    expect(() => create('Приём кардиолога', 'c2')(state)).toThrow('уже есть');
    state = renameCollection(state, 'c1', 'Кардиология');
    expect(state.collections[0]?.name).toBe('Кардиология');
    state = deleteCollection(state, 'c1');
    expect(state.collections).toEqual([]);
  });

  it('keeps items missing from the catalog and round-trips through storage', () => {
    const state = setItemInCollection(
      create('Старое', 'c1')(),
      'c1',
      tool('tool.removed'),
      true,
      AT,
    );
    const storage = memoryStorage();
    saveItemCollections(state, storage);
    expect(loadItemCollections(storage).collections[0]?.items).toEqual([
      { kind: 'tool', id: 'tool.removed', addedAt: AT },
    ]);
  });

  it('migrates a version-1 tool list without losing a choice and leaves it in place', () => {
    const legacy = JSON.stringify({
      version: 1,
      favorites: ['calc.bmi', 'assessment.phq9'],
      collections: [{ id: 'c1', name: 'Приём', toolIds: ['calc.qtc'], createdAt: 't' }],
    });
    const storage = memoryStorage({ [TOOL_COLLECTIONS_KEY]: legacy });
    const state = loadItemCollections(storage, () => AT);
    expect(state.favorites).toEqual([
      { kind: 'tool', id: 'calc.bmi', addedAt: AT },
      { kind: 'tool', id: 'assessment.phq9', addedAt: AT },
    ]);
    expect(state.collections).toEqual([
      {
        id: 'c1',
        name: 'Приём',
        items: [{ kind: 'tool', id: 'calc.qtc', addedAt: AT }],
        createdAt: 't',
      },
    ]);
    expect(storage.values.get(TOOL_COLLECTIONS_KEY)).toBe(legacy);
    // Once saved, the version-2 entry wins over the old one.
    saveItemCollections(toggleFavoriteItem(state, tool('calc.bmi'), AT), storage);
    expect(loadItemCollections(storage, () => AT).favorites.map((item) => item.id)).toEqual([
      'assessment.phq9',
    ]);
  });

  it('reports unreadable stored JSON without its content and starts empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const secret = '{"version":1,"favorites":["пациент Иванов"';
    expect(loadItemCollections(memoryStorage({ [TOOL_COLLECTIONS_KEY]: secret }))).toEqual(
      EMPTY_ITEM_COLLECTIONS,
    );
    expect(loadItemCollections(memoryStorage({ [ITEM_COLLECTIONS_KEY]: '{not json' }))).toEqual(
      EMPTY_ITEM_COLLECTIONS,
    );
    expect(warn).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('SyntaxError');
    expect(logged).not.toContain('Иванов');
    expect(logged).not.toContain('not json');
  });

  it('drops malformed version-2 entries', () => {
    const parsed = parseItemCollections({
      version: 2,
      favorites: [
        { kind: 'tool', id: 'a', addedAt: AT },
        { kind: 'tool', id: 'a', addedAt: AT },
        { kind: 'widget', id: 'b', addedAt: AT },
        { kind: 'document', id: '', addedAt: AT },
        { kind: 'document', id: 'doc.1' },
      ],
      collections: [{ id: 'c1', name: 'Ок', items: 'nope', createdAt: 't' }],
    });
    expect(parsed.favorites).toEqual([{ kind: 'tool', id: 'a', addedAt: AT }]);
    expect(parsed.collections).toEqual([{ id: 'c1', name: 'Ок', items: [], createdAt: 't' }]);
    expect(parseItemCollections({ version: 3 })).toEqual(EMPTY_ITEM_COLLECTIONS);
  });
});
