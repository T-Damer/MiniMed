import { afterEach, describe, expect, it } from 'vitest';

import {
  activeProfile,
  profileAllows,
  profileHidesNavigation,
  resetProfileCache,
  settingShown,
} from '@/state/app-profile';

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

  it('hides the settings rows that do nothing in the profile', () => {
    activeProfile('?profile=off');
    expect(settingShown('floating-windows')).toBe(true);
    resetProfileCache();
    activeProfile('?profile=diaries');
    expect(settingShown('floating-windows')).toBe(false);
    expect(settingShown('useful-features')).toBe(false);
  });

  it('allows only its own routes', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileAllows('#/notes/diaries', profile)).toBe(true);
    expect(profileAllows('#/notes/diaries/abcdefabcdefabcdef12', profile)).toBe(true);
    expect(profileAllows('#/notes/diaries-x', profile)).toBe(false);
    expect(profileAllows('#/search', profile)).toBe(false);
    expect(profileAllows('#/search', undefined)).toBe(true);
  });

  it('allows the settings routes its bar links to', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileAllows('#/settings', profile)).toBe(true);
    expect(profileAllows('#/settings/appearance', profile)).toBe(true);
    expect(profileAllows('#/settings-x', profile)).toBe(false);
  });

  it('declares a limited bottom bar whose addresses all belong to the profile', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileHidesNavigation(profile)).toBe(false);
    expect(profileHidesNavigation(undefined)).toBe(false);
    expect(profile?.navigation.map((item) => [item.id, item.label, item.hash])).toEqual([
      ['notes', 'Пациенты', '#/notes/diaries'],
      ['assessments', 'Опросники', '#/assessments/mine'],
      ['settings', 'Настройки', '#/settings'],
    ]);
    for (const item of profile?.navigation ?? [])
      expect(profileAllows(item.hash, profile)).toBe(true);
  });

  it('allows the own-questionnaire list, its editor and run pages, but not the test catalog', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileAllows('#/assessments/mine', profile)).toBe(true);
    expect(profileAllows('#/assessments/mine/new', profile)).toBe(true);
    expect(profileAllows('#/assessments/mine/abc/edit', profile)).toBe(true);
    expect(profileAllows('#/assessments/mine/abc/results/r1', profile)).toBe(true);
    expect(profileAllows('#/assessments', profile)).toBe(false);
    expect(profileAllows('#/assessments/mine-x', profile)).toBe(false);
  });

  it('offers only the settings pages it declares', () => {
    expect(activeProfile('?profile=diaries')?.settingsPages).toEqual(['clinician', 'appearance']);
  });
});
