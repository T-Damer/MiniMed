import { describe, expect, it } from 'vitest';
import { type CoreLineInput, coreLineState } from './core-line-state';

const base: CoreLineInput = {
  ready: false,
  downloading: true,
  deferred: false,
  error: undefined,
  progress: undefined,
};

describe('coreLineState', () => {
  it('shows the percent and never a download speed while bytes arrive', () => {
    const state = coreLineState({
      ...base,
      progress: { loaded: 37, total: 100, phase: 'downloading' },
    });
    expect(state).toEqual({
      kind: 'downloading',
      fraction: 0.37,
      label: '37 %',
      compactLabel: '37 %',
    });
  });

  it('counts bytes when the total is unknown', () => {
    const state = coreLineState({ ...base, progress: { loaded: 5 * 1024 * 1024, total: 0 } });
    expect(state.fraction).toBeUndefined();
    expect(state.label).toBe('5,0 МБ');
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
    expect(deferred.label).toContain('Основная база не скачана · около');
    expect(deferred.compactLabel).toBe('Не скачано');
    expect(coreLineState({ ...base, error: 'x' }).compactLabel).toBe('База не скачана');
    expect(coreLineState({ ...base, progress: { loaded: 50, total: 100 } }).compactLabel).toBe(
      '50 %',
    );
  });

  it('reports an error and a finished install', () => {
    expect(coreLineState({ ...base, error: 'x' }).kind).toBe('error');
    expect(coreLineState({ ...base, ready: true })).toMatchObject({ kind: 'ready', fraction: 1 });
  });
});
