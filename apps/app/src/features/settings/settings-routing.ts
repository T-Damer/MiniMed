import { isSettingsPageId, type SettingsPageId } from '@/features/settings/settings-pages';

export const SETTINGS_ROOT_HASH = '#/settings';
export const SETTINGS_DOWNLOADS_HASH = '#/settings/downloads';
export const SETTINGS_REFERENCE_IMAGES_HASH = '#/settings/images/reference';

/** `index` is the list; a page id its sub-page; `reference-images` the sub-page of «Изображения». */
export type SettingsRoute = 'index' | SettingsPageId | 'reference-images';

export function settingsPageHash(id: SettingsPageId | 'reference-images'): string {
  return id === 'reference-images' ? SETTINGS_REFERENCE_IMAGES_HASH : `${SETTINGS_ROOT_HASH}/${id}`;
}

function settingsSegments(route: string): readonly string[] | null {
  const segments = route
    .replace(/^#?\/?/u, '')
    .split('/')
    .filter(Boolean);
  return segments[0] === 'settings' ? segments.slice(1) : null;
}

export function readSettingsRoute(hash = window.location.hash): SettingsRoute {
  const segments = settingsSegments(hash);
  const [page, child] = segments ?? [];
  if (!page || !isSettingsPageId(page)) return 'index';
  if (page === 'images' && child === 'reference') return 'reference-images';
  return page;
}

/** Where the native/browser back control of a settings route leads; the list has no parent. */
export function settingsParentHash(route: string): string | null {
  const resolved = readSettingsRoute(`#/${route.replace(/^#?\/?/u, '')}`);
  if (settingsSegments(route) === null || resolved === 'index') return null;
  return resolved === 'reference-images' ? settingsPageHash('images') : SETTINGS_ROOT_HASH;
}

/**
 * One-shot request to open a page when the list is next shown, e.g. the home update notice that
 * leads straight to «Основные».
 */
let pendingPage: SettingsPageId | undefined;

export function requestSettingsPage(id: SettingsPageId): void {
  pendingPage = id;
}

export function consumeRequestedSettingsPage(): SettingsPageId | undefined {
  const page = pendingPage;
  pendingPage = undefined;
  return page;
}
