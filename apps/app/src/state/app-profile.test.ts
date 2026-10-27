import { afterEach, describe, expect, it } from 'vitest';

import { activeProfile, profileAllows, resetProfileCache } from '@/state/app-profile';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
    location: { search: '' },
  },
  configurable: true,
});

afterEach(() => resetProfileCache());

describe('app profiles', () => {
  it('turns on from the address, is remembered, and turns off', () => {
    expect(activeProfile('')).toBeUndefined();
    resetProfileCache();
    expect(activeProfile('?profile=diaries')?.home).toBe('#/notes/diaries');
    resetProfileCache();
    expect(activeProfile('')?.id).toBe('diaries');
    resetProfileCache();
    expect(activeProfile('?profile=off')).toBeUndefined();
    resetProfileCache();
    expect(activeProfile('')).toBeUndefined();
  });

  it('allows only its own routes', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileAllows('#/notes/diaries', profile)).toBe(true);
    expect(profileAllows('#/notes/diaries/abcdefabcdefabcdef12', profile)).toBe(true);
    expect(profileAllows('#/notes/diaries-x', profile)).toBe(false);
    expect(profileAllows('#/search', profile)).toBe(false);
    expect(profileAllows('#/search', undefined)).toBe(true);
  });
});
