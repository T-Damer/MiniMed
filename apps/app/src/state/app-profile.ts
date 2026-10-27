/**
 * App profiles: a narrowed app for one job (owner 2026-10-27: «disable navigation except the
 * selected route; with one route, no bottom bar»). `?profile=<id>` turns one on and is remembered
 * on this device, so a home-screen shortcut keeps it; `?profile=off` turns it off. A profile is
 * declared data: the shell reads its fields and never branches on its id.
 */
const STORAGE_KEY = 'minimed.app-profile.v1';

export interface AppProfile {
  readonly id: string;
  /** Where the app opens and where a route outside the profile returns to. */
  readonly home: string;
  /** Route prefixes the profile allows (hash form). */
  readonly routes: readonly string[];
  readonly hideNavigation: boolean;
}

export const APP_PROFILES: readonly AppProfile[] = [
  {
    id: 'diaries',
    home: '#/notes/diaries',
    routes: ['#/notes/diaries'],
    hideNavigation: true,
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
