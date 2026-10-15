import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_PREFERENCES_KEY, loadAppPreferences } from '@/state/app-preferences';
import {
  hideUsefulFeatures,
  setUsefulFeaturesShown,
  USEFUL_FEATURES_HIDDEN_NOTICE,
  usefulFeaturesShown,
} from './useful-features';

describe('useful features setting', () => {
  beforeEach(() => {
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
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the carousel by default', () => {
    expect(usefulFeaturesShown()).toBe(true);
  });

  it('closing from the carousel stores the choice and says where to undo it', () => {
    const announce = vi.fn();
    hideUsefulFeatures(announce);
    expect(usefulFeaturesShown()).toBe(false);
    expect(loadAppPreferences().usefulFeaturesHidden).toBe(true);
    expect(announce).toHaveBeenCalledExactlyOnceWith(USEFUL_FEATURES_HIDDEN_NOTICE);
    expect(USEFUL_FEATURES_HIDDEN_NOTICE).toBe('Вернуть можно в настройках');
  });

  it('the Settings switch brings the carousel back and keeps other preferences', () => {
    window.localStorage.setItem(
      APP_PREFERENCES_KEY,
      JSON.stringify({ vibrationEnabled: false, usefulFeaturesHidden: true }),
    );
    expect(usefulFeaturesShown()).toBe(false);
    setUsefulFeaturesShown(true);
    expect(usefulFeaturesShown()).toBe(true);
    expect(loadAppPreferences().vibrationEnabled).toBe(false);
  });
});
