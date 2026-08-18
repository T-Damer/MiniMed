export const SETTINGS_ROOT_HASH = '#/settings';
export const SETTINGS_DOWNLOADS_HASH = '#/settings/downloads';

export type SettingsRoute = 'index' | 'downloads';

export function readSettingsRoute(hash = window.location.hash): SettingsRoute {
  const route = hash.replace(/^#\/?/u, '');
  if (route === 'settings/downloads' || route.startsWith('settings/downloads/')) return 'downloads';
  return 'index';
}

export function settingsParentHash(route: string): string | null {
  if (route === 'settings/downloads' || route.startsWith('settings/downloads/')) {
    return SETTINGS_ROOT_HASH;
  }
  return null;
}
