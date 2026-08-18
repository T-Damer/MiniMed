import type { SearchScope } from '@/features/search/ScopedMedicalCore';

export interface AppPreferences {
  readonly vibrationEnabled: boolean;
  readonly rememberSearchMode: boolean;
  readonly soundVolume: number;
  readonly bookReadingMode: boolean;
}

export const APP_PREFERENCES_KEY = 'minimed.app-preferences.v1';
export const SEARCH_SCOPE_KEY = 'minimed.search-scope.v1';
export const APP_PREFERENCES_EVENT = 'minimed:app-preferences';

const DEFAULT_PREFERENCES: AppPreferences = {
  vibrationEnabled: true,
  rememberSearchMode: false,
  soundVolume: 0.2,
  bookReadingMode: false,
};

const VALID_SCOPES = new Set<SearchScope>([
  'diagnosis',
  'guidelines',
  'medications',
  'legal',
  'all',
  'personal',
]);

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREFERENCES.soundVolume;
  return Math.max(0, Math.min(1, value));
}

function normalizePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_PREFERENCES;
  const candidate = value as {
    readonly vibrationEnabled?: unknown;
    readonly rememberSearchMode?: unknown;
    readonly soundVolume?: unknown;
    readonly bookReadingMode?: unknown;
  };
  return {
    vibrationEnabled:
      typeof candidate.vibrationEnabled === 'boolean'
        ? candidate.vibrationEnabled
        : DEFAULT_PREFERENCES.vibrationEnabled,
    rememberSearchMode:
      typeof candidate.rememberSearchMode === 'boolean'
        ? candidate.rememberSearchMode
        : DEFAULT_PREFERENCES.rememberSearchMode,
    soundVolume: clampVolume(
      typeof candidate.soundVolume === 'number'
        ? candidate.soundVolume
        : DEFAULT_PREFERENCES.soundVolume,
    ),
    bookReadingMode:
      typeof candidate.bookReadingMode === 'boolean'
        ? candidate.bookReadingMode
        : DEFAULT_PREFERENCES.bookReadingMode,
  };
}

function isSearchScope(value: string): value is SearchScope {
  return VALID_SCOPES.has(value as SearchScope);
}

function dispatchPreferencesChanged(preferences: AppPreferences): void {
  window.dispatchEvent(
    new CustomEvent<AppPreferences>(APP_PREFERENCES_EVENT, { detail: preferences }),
  );
}

function persist(preferences: AppPreferences): AppPreferences {
  window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences));
  dispatchPreferencesChanged(preferences);
  return preferences;
}

export function loadAppPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(APP_PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveAppPreferences(preferences: AppPreferences): AppPreferences {
  return persist(normalizePreferences(preferences));
}

export function getVibrationEnabled(): boolean {
  return loadAppPreferences().vibrationEnabled;
}

export function setVibrationEnabled(enabled: boolean): AppPreferences {
  return saveAppPreferences({ ...loadAppPreferences(), vibrationEnabled: enabled });
}

export function getRememberSearchMode(): boolean {
  return loadAppPreferences().rememberSearchMode;
}

export function setRememberSearchMode(enabled: boolean): AppPreferences {
  const current = loadAppPreferences();
  if (!enabled) clearSearchScope();
  return saveAppPreferences({ ...current, rememberSearchMode: enabled });
}

export function getSoundVolume(): number {
  return loadAppPreferences().soundVolume;
}

export function setSoundVolume(volume: number): AppPreferences {
  return saveAppPreferences({ ...loadAppPreferences(), soundVolume: clampVolume(volume) });
}

export function getBookReadingMode(): boolean {
  return loadAppPreferences().bookReadingMode;
}

export function setBookReadingMode(enabled: boolean): AppPreferences {
  return saveAppPreferences({ ...loadAppPreferences(), bookReadingMode: enabled });
}

export function subscribeAppPreferences(
  listener: (preferences: AppPreferences) => void,
): () => void {
  const handleChange = (event: Event): void => {
    const detail = (event as CustomEvent<AppPreferences>).detail;
    listener(detail ?? loadAppPreferences());
  };
  window.addEventListener(APP_PREFERENCES_EVENT, handleChange);
  return () => window.removeEventListener(APP_PREFERENCES_EVENT, handleChange);
}

export function loadSearchScope(): SearchScope | null {
  try {
    const raw = window.localStorage.getItem(SEARCH_SCOPE_KEY);
    if (!raw || !isSearchScope(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveSearchScope(scope: SearchScope): void {
  if (!getRememberSearchMode()) return;
  window.localStorage.setItem(SEARCH_SCOPE_KEY, scope);
}

export function clearSearchScope(): void {
  window.localStorage.removeItem(SEARCH_SCOPE_KEY);
}
