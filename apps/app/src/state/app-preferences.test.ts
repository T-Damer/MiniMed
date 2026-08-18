import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_PREFERENCES_KEY,
  clearSearchScope,
  getRememberSearchMode,
  getSoundVolume,
  getVibrationEnabled,
  loadAppPreferences,
  loadSearchScope,
  SEARCH_SCOPE_KEY,
  saveAppPreferences,
  saveSearchScope,
  setRememberSearchMode,
  setSoundVolume,
  setVibrationEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();
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
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
    addEventListener: (type: string, listener: EventListener) => {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return store;
}

describe('app-preferences', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads defaults when storage is empty', () => {
    expect(loadAppPreferences()).toEqual({
      vibrationEnabled: true,
      rememberSearchMode: false,
      soundVolume: 0.2,
      bookReadingMode: false,
    });
  });

  it('clamps sound volume and normalizes booleans on read', () => {
    window.localStorage.setItem(
      APP_PREFERENCES_KEY,
      JSON.stringify({
        vibrationEnabled: 'yes',
        rememberSearchMode: false,
        soundVolume: 2,
      }),
    );
    expect(loadAppPreferences()).toEqual({
      vibrationEnabled: true,
      rememberSearchMode: false,
      soundVolume: 1,
      bookReadingMode: false,
    });
  });

  it('dispatches change events and updates getters', () => {
    const listener = vi.fn();
    subscribeAppPreferences(listener);
    setVibrationEnabled(false);
    expect(getVibrationEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ vibrationEnabled: false }));
  });

  it('persists search scope only when remember mode is enabled', () => {
    setRememberSearchMode(true);
    saveSearchScope('medications');
    expect(loadSearchScope()).toBe('medications');
    setRememberSearchMode(false);
    expect(window.localStorage.getItem(SEARCH_SCOPE_KEY)).toBeNull();
    saveSearchScope('legal');
    expect(window.localStorage.getItem(SEARCH_SCOPE_KEY)).toBeNull();
  });

  it('clears stored scope explicitly', () => {
    setRememberSearchMode(true);
    saveSearchScope('all');
    clearSearchScope();
    expect(loadSearchScope()).toBeNull();
  });

  it('accepts the personal search scope', () => {
    setRememberSearchMode(true);
    saveSearchScope('personal');
    expect(loadSearchScope()).toBe('personal');
  });

  it('updates sound volume through the setter', () => {
    setSoundVolume(0.45);
    expect(getSoundVolume()).toBe(0.45);
    saveAppPreferences({ ...loadAppPreferences(), soundVolume: -1 });
    expect(getSoundVolume()).toBe(0);
  });

  it('reads remember search mode from storage', () => {
    expect(getRememberSearchMode()).toBe(false);
    setRememberSearchMode(true);
    expect(getRememberSearchMode()).toBe(true);
  });
});
