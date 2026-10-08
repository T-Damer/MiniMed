/**
 * The colour theme: «Системная / Светлая / Тёмная» (Settings → Внешний вид → Тема).
 *
 * A chosen theme is written as `data-theme="light|dark"` on `<html>`; every `prefers-color-scheme`
 * block in the CSS honours it (build step `src/dev-server/postcss-color-scheme.ts`). «Системная»
 * leaves the attribute off, so the device's scheme decides. index.html applies the stored choice
 * before the first paint; this module keeps it in sync afterwards. The Android status-bar icons
 * follow the same theme (`state/native-system-ui.ts`).
 */
import { motionRate } from '@/state/motion';
import { setNativeThemeOverride } from '@/state/native-system-ui';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const THEME_KEY = 'minimed.theme.v1';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<(theme: ResolvedTheme) => void>();

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/** The theme on screen now: the chosen one, or the device's for «Системная». */
export function resolvedTheme(): ResolvedTheme {
  const preference = getThemePreference();
  if (preference !== 'system') return preference;
  return systemPrefersDark() ? 'dark' : 'light';
}

function writeAttribute(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = preference;
  setNativeThemeOverride(preference === 'system' ? undefined : preference);
}

function notify(): void {
  const theme = resolvedTheme();
  for (const listener of listeners) listener(theme);
}

/** Saves the choice and applies it at once, with a short cross-fade when animations are on. */
export function setThemePreference(preference: ThemePreference): void {
  if (preference === getThemePreference()) return;
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, preference);
  } catch (cause) {
    console.warn('Тема не сохранена в хранилище браузера.', cause);
  }
  const apply = (): void => {
    writeAttribute(preference);
    notify();
  };
  if (
    typeof document.startViewTransition !== 'function' ||
    motionRate() === 0 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    apply();
    return;
  }
  const transition = document.startViewTransition(apply);
  transition.finished.catch((cause: unknown) => {
    console.warn('Переход между темами прерван.', cause);
  });
}

/** Calls `listener` with the resolved theme whenever the choice or the device's scheme changes. */
export function subscribeTheme(listener: (theme: ResolvedTheme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies the stored choice and follows the device's scheme; returns the cleanup. */
export function installTheme(): () => void {
  writeAttribute(getThemePreference());
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  media.addEventListener('change', notify);
  return () => {
    media.removeEventListener('change', notify);
  };
}
