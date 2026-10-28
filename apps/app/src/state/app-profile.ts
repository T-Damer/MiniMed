import type { RootViewItem } from '@/app/root-view';
import type { SettingsPageId } from '@/features/settings/settings-pages';

/**
 * App profiles: a narrowed app for one job (owner 2026-10-27: «disable navigation except the
 * selected route; with one route, no bottom bar»; later: a limited, subtle bottom bar anyway).
 * `?profile=<id>` turns one on and is remembered on this device, so a home-screen shortcut keeps
 * it; `?profile=off` turns it off. A profile is declared data: the shell reads its fields and
 * never branches on its id.
 */
const STORAGE_KEY = 'minimed.app-profile.v1';

/** A bar item: the tab it lights and the address it opens (a tab's own home may be outside the profile). */
export interface AppProfileNavItem extends RootViewItem {
  readonly hash: string;
}

export interface AppProfile {
  readonly id: string;
  /** Where the app opens and where a route outside the profile returns to. */
  readonly home: string;
  /** Route prefixes the profile allows (hash form). */
  readonly routes: readonly string[];
  /** The bottom bar's items, in order; empty hides the bar. */
  readonly navigation: readonly AppProfileNavItem[];
  /** The settings pages the profile offers; all of them when absent. */
  readonly settingsPages?: readonly SettingsPageId[];
  /** The app's own first-run tour and base download are not part of this job. */
  readonly skipOnboarding: boolean;
}

export const APP_PROFILES: readonly AppProfile[] = [
  {
    id: 'diaries',
    home: '#/notes/diaries',
    routes: ['#/notes/diaries', '#/settings', '#/assessments/mine'],
    navigation: [
      { id: 'notes', label: 'Пациенты', icon: 'users', hash: '#/notes/diaries' },
      { id: 'settings', label: 'Настройки', icon: 'system', hash: '#/settings' },
    ],
    settingsPages: ['clinician', 'appearance'],
    skipOnboarding: true,
  },
];

let cached: AppProfile | null | undefined;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The active profile: from the address when given there, else the one remembered. */
export function activeProfile(search = window.location.search): AppProfile | undefined {
  if (cached !== undefined) return cached ?? undefined;
  const requested = new URLSearchParams(search).get('profile');
  if (requested === 'off') {
    storage()?.removeItem(STORAGE_KEY);
    cached = null;
    return undefined;
  }
  const id = requested ?? storage()?.getItem(STORAGE_KEY) ?? undefined;
  const profile = APP_PROFILES.find((candidate) => candidate.id === id);
  if (profile && requested) storage()?.setItem(STORAGE_KEY, profile.id);
  cached = profile ?? null;
  return profile;
}

/** Whether a profile removes the bottom bar entirely (without a profile the app's own bar rules). */
export function profileHidesNavigation(profile: AppProfile | undefined): boolean {
  return profile !== undefined && profile.navigation.length === 0;
}

/** Whether an address belongs to the profile (always true without one). */
export function profileAllows(hash: string, profile: AppProfile | undefined): boolean {
  if (!profile) return true;
  const path = hash.split('?')[0] ?? '';
  return profile.routes.some((route) => path === route || path.startsWith(`${route}/`));
}

/** Test seam: forget the cached profile. */
export function resetProfileCache(): void {
  cached = undefined;
}
