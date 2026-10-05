import { describe, expect, it } from 'vitest';
import { type CoreLineInput, coreLineState } from './core-line-state';

const base: CoreLineInput = {
  ready: false,
  downloading: true,
  deferred: false,
  error: undefined,
  progress: undefined,
  speed: undefined,
};

describe('coreLineState', () => {
  it('shows percent and speed while bytes arrive', () => {
    const state = coreLineState({
      ...base,
      progress: { loaded: 37, total: 100, phase: 'downloading' },
      speed: 4.2 * 1024 * 1024,
    });
    expect(state).toEqual({
      kind: 'downloading',
      fraction: 0.37,
      label: '37 % · 4,2 МБ/с',
      compactLabel: '37 % · 4,2 МБ/с',
    });
  });

  it('leaves the speed out until it is known', () => {
    const state = coreLineState({ ...base, progress: { loaded: 50, total: 100 } });
    expect(state.label).toBe('50 %');
  });

  it('counts bytes when the total is unknown', () => {
    const state = coreLineState({ ...base, progress: { loaded: 5 * 1024 * 1024, total: 0 } });
    expect(state.fraction).toBeUndefined();
    expect(state.label).toBe('5.0 МБ');
  });

  it('names verification and installation instead of showing 100 %', () => {
    expect(
      coreLineState({ ...base, progress: { loaded: 100, total: 100, phase: 'verifying' } }),
    ).toMatchObject({ kind: 'verifying', fraction: undefined });
    expect(
      coreLineState({ ...base, progress: { loaded: 100, total: 100, phase: 'installing' } }),
    ).toMatchObject({ kind: 'installing', fraction: undefined });
  });

  it('is indeterminate until the first byte', () => {
    expect(coreLineState({ ...base, progress: { loaded: 0, total: 100 } }).kind).toBe('connecting');
    expect(coreLineState({ ...base, downloading: false }).kind).toBe('preparing');
  });

  it('offers the decision on a metered connection', () => {
    expect(coreLineState({ ...base, downloading: false, deferred: true }).kind).toBe('deferred');
  });

  it('keeps long messages short where they would cover the onboarding', () => {
    const deferred = coreLineState({ ...base, downloading: false, deferred: true });
    expect(deferred.label).toContain('Мобильная сеть: загрузка ядра около');
    expect(deferred.compactLabel).toBe('Мобильная сеть');
    expect(coreLineState({ ...base, error: 'x' }).compactLabel).toBe('Ядро не скачано');
    expect(coreLineState({ ...base, progress: { loaded: 50, total: 100 } }).compactLabel).toBe(
      '50 %',
    );
  });

  it('reports an error and a finished install', () => {
    expect(coreLineState({ ...base, error: 'x' }).kind).toBe('error');
    expect(coreLineState({ ...base, ready: true })).toMatchObject({ kind: 'ready', fraction: 1 });
  });
});
