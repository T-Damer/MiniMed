import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/state/ui-feedback', () => ({
  installUiFeedback: vi.fn(() => () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn(),
    selectionChanged: vi.fn(),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

vi.mock('@/state/native-haptics', () => ({
  nativeAndroidHapticImpact: vi.fn(),
}));

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe('hapticFeedback', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    installLocalStorageMock();
    const { setVibrationEnabled } = await import('@/state/app-preferences');
    setVibrationEnabled(true);
    vi.stubGlobal('navigator', { vibrate: vi.fn(() => true) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vibrates through the browser API on web, one pulse per strength', async () => {
    const { hapticFeedback, WEB_VIBRATION_MS } = await import('@/state/haptics');
    const { nativeAndroidHapticImpact } = await import('@/state/native-haptics');
    for (const strength of ['selection', 'light', 'medium', 'heavy'] as const) {
      expect(hapticFeedback(strength)).toBe(true);
      expect(navigator.vibrate).toHaveBeenLastCalledWith(WEB_VIBRATION_MS[strength]);
    }
    expect(WEB_VIBRATION_MS.selection).toBeLessThan(WEB_VIBRATION_MS.heavy);
    expect(nativeAndroidHapticImpact).not.toHaveBeenCalled();
  });

  it('does nothing on a browser without the vibration API', async () => {
    vi.stubGlobal('navigator', {});
    const { hapticFeedback } = await import('@/state/haptics');
    expect(hapticFeedback('light')).toBe(false);
  });

  it('no-ops when vibration is disabled', async () => {
    const { setVibrationEnabled } = await import('@/state/app-preferences');
    const { hapticFeedback } = await import('@/state/haptics');
    const { nativeAndroidHapticImpact } = await import('@/state/native-haptics');
    setVibrationEnabled(false);
    expect(hapticFeedback('selection')).toBe(false);
    expect(navigator.vibrate).not.toHaveBeenCalled();
    expect(nativeAndroidHapticImpact).not.toHaveBeenCalled();
  });
});
