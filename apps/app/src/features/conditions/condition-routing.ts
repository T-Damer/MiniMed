import type { ConditionCatalogSection } from './condition-catalog';

export const CONDITION_CATALOG_ROUTE = 'modules/documents/conditions';
export const CONDITION_CATALOG_HASH = `#/${CONDITION_CATALOG_ROUTE}`;

export interface ConditionCatalogRoute {
  readonly section: ConditionCatalogSection;
  readonly entryId: string | null;
}

function isSection(value: string): value is ConditionCatalogSection {
  return (
    value === 'diseases' || value === 'conditions' || value === 'syndromes' || value === 'symptoms'
  );
}

export function isConditionCatalogRoute(hashOrRoute: string): boolean {
  const route = hashOrRoute.replace(/^#\/?/u, '');
  return route === CONDITION_CATALOG_ROUTE || route.startsWith(`${CONDITION_CATALOG_ROUTE}/`);
}

export function parseConditionCatalogRoute(hashOrRoute: string): ConditionCatalogRoute | null {
  const route = hashOrRoute.replace(/^#\/?/u, '');
  if (!isConditionCatalogRoute(route)) return null;
  const suffix = route.slice(CONDITION_CATALOG_ROUTE.length).replace(/^\//u, '');
  if (!suffix) return { section: 'diseases', entryId: null };
  const [rawSection, rawEntryId] = suffix.split('/', 2);
  if (!rawSection || !isSection(rawSection)) return { section: 'diseases', entryId: null };
  if (!rawEntryId) return { section: rawSection, entryId: null };
  try {
    return { section: rawSection, entryId: decodeURIComponent(rawEntryId) || null };
  } catch {
    return { section: rawSection, entryId: null };
  }
}

export function conditionCatalogHash(section: ConditionCatalogSection, entryId?: string): string {
  return `#/${CONDITION_CATALOG_ROUTE}/${section}${entryId ? `/${encodeURIComponent(entryId)}` : ''}`;
}
