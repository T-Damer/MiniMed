import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/downloads/download-service', () => ({ getDownloadQueue: vi.fn() }));

import { chooseInstallModel, formatModelSize, installPhase } from './asr-model-install';
import type { AsrModelDescriptor } from './asr-models';

const model = (id: string, overrides: Partial<AsrModelDescriptor> = {}): AsrModelDescriptor => ({
  id,
  name: id,
  description: '',
  choiceLabel: id,
  choiceHint: '',
  language: 'multilingual',
  preferredForRussian: false,
  runtimeReady: true,
  ...overrides,
});

describe('chooseInstallModel', () => {
  const fast = model('fast', { preferredForRussian: true });
  const exact = model('exact');
  const future = model('future', { runtimeReady: false, preferredForRussian: true });

  it('offers the chosen model first, then one already on the device, then the fast default', () => {
    const all = [future, fast, exact];
    expect(chooseInstallModel(all, 'exact', new Set())?.id).toBe('exact');
    expect(chooseInstallModel(all, null, new Set(['exact']))?.id).toBe('exact');
    expect(chooseInstallModel(all, null, new Set())?.id).toBe('fast');
  });

  it('never offers a model the browser cannot run', () => {
    expect(chooseInstallModel([future], 'future', new Set(['future']))).toBeUndefined();
  });
});

describe('installPhase', () => {
  const base = { ready: false, loading: false, failed: false, cached: false, known: true };

  it('puts ready first, then a running download, then what the device holds', () => {
    expect(installPhase({ ...base, ready: true, loading: true })).toBe('ready');
    expect(installPhase({ ...base, loading: true, failed: true })).toBe('loading');
    expect(installPhase({ ...base, failed: true })).toBe('failed');
    expect(installPhase({ ...base, cached: true })).toBe('cached');
    expect(installPhase(base)).toBe('missing');
    expect(installPhase({ ...base, known: false })).toBe('checking');
  });
});

describe('formatModelSize', () => {
  it('rounds to whole megabytes', () => {
    expect(formatModelSize(81_300_000)).toBe('81 МБ');
    expect(formatModelSize(253_500_000)).toBe('254 МБ');
    expect(formatModelSize(100)).toBe('1 МБ');
  });
});
