import type { AppGlyphName } from '@/components/AppGlyph';
import { isHerbalBookRoute } from '@/features/herbal/herbal-routing';
import {
  isUserLibraryCatalogRoute,
  migrateLegacyUserDocumentHash,
  USER_LIBRARY_CATALOG_HASH,
} from '@/features/library/user-library-routing';
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

/** One tab of a floating tab bar (`BottomNav`): the main app's views or the patient diary's. */
export interface NavItem<V extends string = string> {
  readonly id: V;
  readonly label: string;
  readonly icon: AppGlyphName;
}

export type RootViewItem = NavItem<RootView>;

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

/**
 * Where the «Файлы» tab opens when it is entered from another tab. The file list is the home of
 * the tab; the one place that is restored is an open personal document (its reading position is
 * kept per document, and the reader has a way back to the list). Forms, patient cards and notes
 * autosave their drafts and are reached from the list again in one tap — returning straight into
 * the half-filled form left a first-time user wondering where the files were.
 */
export function filesTabHash(lastHash: string): string {
  return parseDocumentReadRoute(lastHash)?.kind === 'user' ||
    isUserLibraryCatalogRoute(lastHash.replace(/^#\/?/u, ''))
    ? lastHash
    : USER_LIBRARY_CATALOG_HASH;
}

export const ROOT_VIEW_ORDER = new Map(ROOT_VIEWS.map((item, index) => [item.id, index]));

export const COMPACT_ROOT_VIEWS: readonly RootViewItem[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'notes', label: 'Мои файлы', icon: 'folder-open' },
  { id: 'news', label: 'Лента', icon: 'newspaper' },
  { id: 'settings', label: 'Настройки', icon: 'system' },
];

/** Tools opened from search that live under the notes routes: the bar keeps «Поиск» lit for them. */
const SEARCH_TOOL_NOTES_ROUTES = [
  '#/notes/drug-interactions',
  '#/notes/drug-comparison',
  '#/notes/vaccination',
] as const;

/**
 * The tab the compact bar lights. The herbal book is both a section of search and a folder of
 * «Мои файлы», so it keeps `herbalOrigin`, the tab it was opened from (`herbalBookOrigin`).
 */
export function compactRootView(view: RootView, hash: string, herbalOrigin?: RootView): RootView {
  if (view === 'settings') return 'settings';
  if (isHerbalBookRoute(hash) && (herbalOrigin === 'search' || herbalOrigin === 'notes')) {
    return herbalOrigin;
  }
  if (view === 'news') return 'news';
  if (SEARCH_TOOL_NOTES_ROUTES.some((route) => hash === route || hash.startsWith(`${route}?`))) {
    return 'search';
  }
  // «База знаний» is a folder of «Мои файлы» in the compact bar, so its pages keep that tab lit.
  if (view === 'notes' || view === 'modules' || parseDocumentReadRoute(hash)?.kind === 'user') {
    return 'notes';
  }
  return 'search';
}

/**
 * Entering the herbal book records the tab of the address it was entered from; moving inside the
 * book keeps it. Read from the addresses, not the view signal, which changes a moment earlier.
 */
export function herbalBookOrigin(
  previousHash: string,
  nextHash: string,
  current: RootView | undefined,
): RootView | undefined {
  if (!isHerbalBookRoute(nextHash)) return undefined;
  if (isHerbalBookRoute(previousHash)) return current;
  return compactRootView(viewFromHash(previousHash), previousHash);
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
