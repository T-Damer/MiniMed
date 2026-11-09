import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeProfile,
  builtInScaleRoute,
  profileAllows,
  profileHidesNavigation,
  profileTabFor,
  resetProfileCache,
  SHARED_TOOL_PROFILE,
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

  it('opens a shared calculator link over a remembered profile, and remembers nothing', () => {
    expect(activeProfile('?profile=diaries')?.id).toBe('diaries');
    resetProfileCache();
    const shared = activeProfile('?share=tool');
    expect(shared).toBe(SHARED_TOOL_PROFILE);
    expect(profileHidesNavigation(shared)).toBe(true);
    expect(profileAllows('#/calculators/minimed.calculator.ciwa-ar?tremor=4', shared)).toBe(true);
    expect(profileAllows('#/notes/diaries', shared)).toBe(false);
    resetProfileCache();
    // The device keeps the profile it had: the link did not replace it.
    expect(activeProfile('')?.id).toBe('diaries');
    resetProfileCache();
    activeProfile('?profile=off');
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
      ['assessments', 'Библиотека', '#/assessments/mine'],
      ['settings', 'Настройки', '#/settings'],
    ]);
    for (const item of profile?.navigation ?? [])
      expect(profileAllows(item.hash, profile)).toBe(true);
  });

  it('opens the CBT worksheets under «Библиотека» and marks that tab', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profileAllows('#/notes/worksheets/cbt-thought-record', profile)).toBe(true);
    expect(profileTabFor('#/notes/worksheets', profile)).toBe('assessments');
    expect(profileTabFor('#/notes/worksheets/own-1/edit?x=1', profile)).toBe('assessments');
    expect(profileTabFor('#/notes/worksheets-x', profile)).toBeUndefined();
    expect(profileTabFor('#/notes/diaries', profile)).toBeUndefined();
    expect(profileTabFor('#/notes/worksheets', undefined)).toBeUndefined();
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

  it('allows the page of each built-in scale of its list, with drafts and results below it, and no other test', () => {
    const profile = activeProfile('?profile=diaries');
    expect(profile?.builtInScales?.length).toBeGreaterThan(0);
    for (const scale of profile?.builtInScales ?? []) {
      const page = builtInScaleRoute(scale);
      expect(profileAllows(page, profile)).toBe(true);
      expect(profileAllows(`${page}/resume/r1`, profile)).toBe(true);
      expect(profileAllows(`${page}/results/r1`, profile)).toBe(true);
    }
    expect(profileAllows('#/assessments/psychiatry/phq-9', profile)).toBe(true);
    expect(profileAllows('#/assessments/obstetrics/postnatal-mood-epds', profile)).toBe(true);
    // The sections, the rest of the catalog and look-alike slugs stay out.
    expect(profileAllows('#/assessments/psychiatry', profile)).toBe(false);
    expect(profileAllows('#/assessments/psychiatry/phq-9-x', profile)).toBe(false);
    expect(
      profileAllows('#/assessments/psychiatry/hamilton-depression-rating-scale', profile),
    ).toBe(false);
    expect(profileAllows('#/assessments/obstetrics/pregnancy-due-date', profile)).toBe(false);
  });

  it('offers only the settings pages it declares', () => {
    expect(activeProfile('?profile=diaries')?.settingsPages).toEqual(['clinician', 'appearance']);
  });
});

describe('a build for one job', () => {
  it('is always its profile, whatever the address asks', async () => {
    vi.stubEnv('VITE_APP_PROFILE', 'diaries');
    vi.resetModules();
    const locked = await import('@/state/app-profile');
    expect(locked.activeProfile('?profile=off')?.id).toBe('diaries');
    locked.resetProfileCache();
    expect(locked.activeProfile('')?.id).toBe('diaries');
    expect(locked.profileAllows('#/search', locked.activeProfile())).toBe(false);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
