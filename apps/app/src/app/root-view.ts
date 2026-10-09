import type { AppGlyphName } from '@/components/AppGlyph';
import { migrateLegacyUserDocumentHash } from '@/features/library/user-library-routing';
import {
  isDocumentReadRoute,
  migrateLegacyDocumentHash,
  migrateLegacyOverlaySearch,
  parseDocumentReadRoute,
} from '@/state/document-route';
import {
  beginDocumentTrail,
  clearDocumentTrail,
  loadDocumentTrail,
  viewFromHash,
} from '@/state/document-trail';
import { overlayFromLocationSearch, stripOrphanedOverlaySearch } from '@/state/overlay-route';

export type RootView =
  | 'search'
  | 'modules'
  | 'assessments'
  | 'calculators'
  | 'notes'
  | 'news'
  | 'settings';

export interface RootViewItem {
  readonly id: RootView;
  readonly label: string;
  readonly icon: AppGlyphName;
}

export const ROOT_VIEWS: readonly RootViewItem[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'modules', label: 'База знаний', icon: 'modules' },
  { id: 'assessments', label: 'Тесты', icon: 'list-checks' },
  { id: 'calculators', label: 'Калькуляторы', icon: 'calculator' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
  { id: 'news', label: 'Лента', icon: 'newspaper' },
  { id: 'settings', label: 'Настройки', icon: 'system' },
];

/**
 * Tabs that always open at their own list (owner 2026-10-09): switching back to the calculators tab
 * shows the list with the recently used calculators, not the tool left open there. Every other tab
 * returns to the route and scroll position it was left on.
 */
const ROOT_VIEWS_OPENING_AT_LIST: ReadonlySet<RootView> = new Set(['calculators']);

export function rootViewRestoresRoute(view: RootView): boolean {
  return !ROOT_VIEWS_OPENING_AT_LIST.has(view);
}

export const ROOT_VIEW_ORDER = new Map(ROOT_VIEWS.map((item, index) => [item.id, index]));

export const COMPACT_ROOT_VIEWS: readonly RootViewItem[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'notes', label: 'Мои файлы', icon: 'folder-open' },
  { id: 'news', label: 'Лента', icon: 'newspaper' },
  { id: 'settings', label: 'Настройки', icon: 'system' },
];

export function compactRootView(view: RootView, hash: string): RootView {
  if (view === 'settings') return 'settings';
  if (view === 'news') return 'news';
  if (
    view === 'notes' ||
    parseDocumentReadRoute(hash)?.kind === 'user' ||
    (view === 'modules' && hash.startsWith('#/modules/documents/user'))
  ) {
    return 'notes';
  }
  return 'search';
}

export function viewFromLocation(hash = window.location.hash): RootView {
  if (isDocumentReadRoute(hash)) {
    const trail = loadDocumentTrail();
    if (trail) return trail.origin.view;
    const parsed = parseDocumentReadRoute(hash);
    return parsed?.kind === 'user' ? 'modules' : 'search';
  }
  return viewFromHash(hash);
}

export function redirectLegacySettingsRoutes(): void {
  const value = window.location.hash.replace(/^#\/?/u, '');
  if (value === 'modules/model' || value === 'status') {
    window.history.replaceState({ view: 'settings' }, '', '#/settings');
  }
}

export function bootstrapDocumentReadLocation(): void {
  migrateLegacyDocumentHash();
  migrateLegacyUserDocumentHash();
  migrateLegacyOverlaySearch();
}

export function syncDocumentReadState(): boolean {
  migrateLegacyDocumentHash();
  migrateLegacyUserDocumentHash();
  const overlayPending = overlayFromLocationSearch(window.location.search);
  if (overlayPending && !isDocumentReadRoute(window.location.hash)) {
    const trail = loadDocumentTrail();
    if (!trail || trail.crumbs.length === 0) {
      beginDocumentTrail('official');
    }
  }
  migrateLegacyOverlaySearch();
  const active = isDocumentReadRoute(window.location.hash);
  if (!active) clearDocumentTrail();
  stripOrphanedOverlaySearch(active);
  return active;
}

export function countPublishedCatalogModules(
  modules: readonly { releaseState: string; tags: readonly string[] }[],
): number {
  return modules.filter(
    (module) =>
      module.releaseState === 'published' && !module.tags.includes('individual-recommendation'),
  ).length;
}
