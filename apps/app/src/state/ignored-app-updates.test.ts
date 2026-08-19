import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IGNORED_APP_UPDATES_KEY,
  ignoreAppUpdate,
  isHomeAppUpdateVisible,
  loadIgnoredAppUpdates,
  parseIgnoredAppUpdates,
} from '@/state/ignored-app-updates';

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  return store;
}

describe('ignored app updates', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses ignoreUpdate version lists and ignores corrupt snapshots', () => {
    expect(parseIgnoredAppUpdates(null)).toEqual([]);
    expect(parseIgnoredAppUpdates('{"ignoreUpdate":["0.6.29","0.6.28"]}')).toEqual([
      '0.6.29',
      '0.6.28',
    ]);
    expect(parseIgnoredAppUpdates('{')).toEqual([]);
  });

  it('hides the home notice for a dismissed version and shows a newer one', () => {
    expect(isHomeAppUpdateVisible('0.6.29', [])).toBe(true);
    expect(isHomeAppUpdateVisible('0.6.29', ['0.6.29'])).toBe(false);
    expect(isHomeAppUpdateVisible('0.6.30', ['0.6.29'])).toBe(true);
    expect(isHomeAppUpdateVisible(undefined, [])).toBe(false);
  });

  it('stores dismissed versions under ignoreUpdate', () => {
    expect(ignoreAppUpdate('0.6.29')).toEqual(['0.6.29']);
    expect(ignoreAppUpdate('0.6.30')).toEqual(['0.6.30', '0.6.29']);
    expect(loadIgnoredAppUpdates()).toEqual(['0.6.30', '0.6.29']);
    expect(JSON.parse(window.localStorage.getItem(IGNORED_APP_UPDATES_KEY) ?? '{}')).toEqual({
      ignoreUpdate: ['0.6.30', '0.6.29'],
    });
  });
});
