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

export type RootView = 'search' | 'modules' | 'assessments' | 'calculators' | 'notes' | 'settings';

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
  { id: 'settings', label: 'Настройки', icon: 'system' },
];

export const ROOT_VIEW_ORDER = new Map(ROOT_VIEWS.map((item, index) => [item.id, index]));

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
