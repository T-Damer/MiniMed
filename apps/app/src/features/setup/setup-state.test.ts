import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreAutoDownloadAllowed, downloadPercent } from './setup-state';

describe('download percent', () => {
  it('uses indeterminate progress when total is not known', () => {
    expect(downloadPercent(20, null)).toBeUndefined();
    expect(downloadPercent(20, 0)).toBeUndefined();
    expect(downloadPercent(20, Number.NaN)).toBeUndefined();
    expect(downloadPercent(Number.NaN, 100)).toBeUndefined();
  });

  it('clamps finite progress without pretending verification equals download completion', () => {
    expect(downloadPercent(25, 100)).toBe(25);
    expect(downloadPercent(120, 100)).toBe(100);
    expect(downloadPercent(-20, 100)).toBe(0);
  });
});

describe('core auto-download policy', () => {
  it('starts on unknown, wifi and ethernet connections', () => {
    expect(coreAutoDownloadAllowed(undefined)).toBe(true);
    expect(coreAutoDownloadAllowed({ type: 'wifi' })).toBe(true);
    expect(coreAutoDownloadAllowed({ type: 'ethernet', saveData: false })).toBe(true);
  });

  it('waits for the user on cellular or data-saver connections', () => {
    expect(coreAutoDownloadAllowed({ type: 'cellular' })).toBe(false);
    expect(coreAutoDownloadAllowed({ type: 'wifi', saveData: true })).toBe(false);
  });
});

describe('onboarding dismissal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('remembers the dismissal in storage and for the session', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const { dismissSetup, isSetupDismissed } = await import('./setup-state');
    expect(isSetupDismissed()).toBe(false);
    dismissSetup();
    expect(store.get('minimed:package-setup-dismissed:v1')).toBe('1');
    expect(isSetupDismissed()).toBe(true);
  });

  it('still counts as dismissed for the session when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const { dismissSetup, isSetupDismissed } = await import('./setup-state');
    expect(isSetupDismissed()).toBe(false);
    dismissSetup();
    expect(isSetupDismissed()).toBe(true);
  });
});
