import type { RootViewItem } from '@/app/root-view';
import {
  DIARY_QUESTIONNAIRES,
  type DiaryQuestionnaireOption,
} from '@/features/diary/diary-questionnaires';
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

/** Settings rows that only matter to the full app; a profile without that part hides them. */
export type SettingsRowId = 'split-navigation' | 'useful-features' | 'floating-windows';

export interface AppProfile {
  readonly id: string;
  /** Where the app opens and where a route outside the profile returns to. */
  readonly home: string;
  /** Route prefixes the profile allows (hash form). */
  readonly routes: readonly string[];
  /**
   * The built-in scales its questionnaire list offers next to the user's own; each one's page
   * (and the drafts and results below it) is an allowed route, the rest of the catalog is not.
   */
  readonly builtInScales?: readonly DiaryQuestionnaireOption[];
  /** The bottom bar's items, in order; empty hides the bar. */
  readonly navigation: readonly AppProfileNavItem[];
  /** The settings pages the profile offers; all of them when absent. */
  readonly settingsPages?: readonly SettingsPageId[];
  /** Rows of the offered pages that do nothing in this profile. */
  readonly hiddenSettings?: readonly SettingsRowId[];
  /** The app's own first-run tour and base download are not part of this job. */
  readonly skipOnboarding: boolean;
  /**
   * Nothing in the profile searches the knowledge base, so the app neither opens nor downloads its
   * search core (a 440 MB database) and does not read the downloadable-module catalog at start-up.
   */
  readonly skipSearchCore?: boolean;
}

/** The address of one built-in scale's page: its section and its slug. */
export function builtInScaleRoute(scale: Pick<DiaryQuestionnaireOption, 'bank' | 'slug'>): string {
  return `#/assessments/${scale.bank}/${scale.slug}`;
}

export const APP_PROFILES: readonly AppProfile[] = [
  {
    id: 'diaries',
    home: '#/notes/diaries',
    routes: [
      '#/notes/diaries',
      '#/settings',
      '#/assessments/mine',
      ...DIARY_QUESTIONNAIRES.map(builtInScaleRoute),
    ],
    builtInScales: DIARY_QUESTIONNAIRES,
    navigation: [
      { id: 'notes', label: 'Пациенты', icon: 'users', hash: '#/notes/diaries' },
      // Every questionnaire a diary can carry: the built-in scales and the doctor's own, with the
      // editor and the run pages below the list.
      { id: 'assessments', label: 'Опросники', icon: 'list-checks', hash: '#/assessments/mine' },
      { id: 'settings', label: 'Настройки', icon: 'system', hash: '#/settings' },
    ],
    settingsPages: ['clinician', 'appearance'],
    // No search home, no section tabs and no documents to float in the diaries profile.
    hiddenSettings: ['split-navigation', 'useful-features', 'floating-windows'],
    skipOnboarding: true,
    skipSearchCore: true,
  },
];

/**
 * A build for one job (`VITE_APP_PROFILE`): the GitVerse copy carries only the diaries (owner
 * 2026-11-03), so it is always that profile, whatever the address or the device remembers.
 */
const LOCKED_PROFILE = import.meta.env.VITE_APP_PROFILE;

let cached: AppProfile | null | undefined;

/** Whether a settings row applies in the active profile (every row without one). */
export function settingShown(id: SettingsRowId): boolean {
  return !activeProfile()?.hiddenSettings?.includes(id);
}

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
  const locked = APP_PROFILES.find((candidate) => candidate.id === LOCKED_PROFILE);
  if (locked) {
    cached = locked;
    return locked;
  }
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
