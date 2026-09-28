import { describe, expect, it } from 'vitest';

import {
  COLLECTION_LAST_TARGET_KEY,
  lastTargetKey,
  loadLastTargets,
  orderByLastTarget,
  rememberLastTarget,
} from './collection-last-target';
import type { ItemCollection } from './item-collections';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[COLLECTION_LAST_TARGET_KEY, initial]] : []);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const collection = (id: string): ItemCollection => ({ id, name: id, items: [], createdAt: 't' });

describe('last save target', () => {
  it('remembers the place per item kind', () => {
    const storage = memoryStorage();
    const medication = { kind: 'document' as const, documentKind: 'medication' };
    const guideline = { kind: 'document' as const, documentKind: 'clinical-recommendation' };
    rememberLastTarget(medication, 'c-cardio', storage);
    rememberLastTarget(guideline, 'favorites', storage);
    rememberLastTarget({ kind: 'note' }, 'c-notes', storage);
    const targets = loadLastTargets(storage);
    expect(targets[lastTargetKey(medication)]).toBe('c-cardio');
    expect(targets[lastTargetKey(guideline)]).toBe('favorites');
    expect(targets[lastTargetKey({ kind: 'note' })]).toBe('c-notes');
    // Only ids are stored.
    expect(storage.values.get(COLLECTION_LAST_TARGET_KEY)).toBe(
      JSON.stringify({
        'document:medication': 'c-cardio',
        'document:clinical-recommendation': 'favorites',
        note: 'c-notes',
      }),
    );
  });

  it('puts the remembered collection first and ignores a deleted one', () => {
    const list = [collection('a'), collection('b'), collection('c')];
    expect(orderByLastTarget(list, 'c').map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(orderByLastTarget(list, 'gone').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(orderByLastTarget(list, undefined)).toBe(list);
  });

  it('survives unreadable storage', () => {
    expect(loadLastTargets(memoryStorage('{oops'))).toEqual({});
    expect(loadLastTargets(memoryStorage('[1,2]'))).toEqual({});
  });
});
