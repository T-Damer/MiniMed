import type { ContentModuleCatalogEntry } from '@localmed/contracts';

export type CatalogSelection =
  | { readonly kind: 'collection'; readonly id: string }
  | { readonly kind: 'category'; readonly id: string }
  | { readonly kind: 'recommendations' }
  | { readonly kind: 'core-library' }
  | { readonly kind: 'laws'; readonly specialty: string }
  | null;

const LAWS_ROUTE_PREFIX = 'modules/documents/laws/';

const SPECIALTY_ALIASES: Readonly<Record<string, string>> = {
  paediatrics: 'pediatrics',
};

export function normalizeLawsSpecialtySlug(value: string): string {
  const decoded = value.trim().toLocaleLowerCase('en-US');
  return SPECIALTY_ALIASES[decoded] ?? decoded;
}

export function catalogSelectionFromLocation(hash = window.location.hash): CatalogSelection {
  const route = hash.replace(/^#\/?/u, '');
  const collectionPrefix = 'modules/documents/collection/';
  const categoryPrefix = 'modules/documents/category/';
  try {
    if (route === 'modules/documents/recommendations') {
      return { kind: 'recommendations' };
    }
    if (route === 'modules/documents/core-library') {
      return { kind: 'core-library' };
    }
    if (route.startsWith(LAWS_ROUTE_PREFIX)) {
      const specialty = normalizeLawsSpecialtySlug(
        decodeURIComponent(route.slice(LAWS_ROUTE_PREFIX.length)),
      );
      if (!specialty) return null;
      return { kind: 'laws', specialty };
    }
    if (route.startsWith(collectionPrefix)) {
      return { kind: 'collection', id: decodeURIComponent(route.slice(collectionPrefix.length)) };
    }
    if (route.startsWith(categoryPrefix)) {
      return { kind: 'category', id: decodeURIComponent(route.slice(categoryPrefix.length)) };
    }
  } catch {
    return null;
  }
  return null;
}

export function lawsRouteForModule(module: ContentModuleCatalogEntry): string | null {
  if (module.kind !== 'regulatory') return null;
  const specialty = module.specialties[0];
  if (!specialty) return null;
  return `#/modules/documents/laws/${encodeURIComponent(specialty)}`;
}

export function regulatoryModuleForSpecialty(
  modules: readonly ContentModuleCatalogEntry[],
  specialtySlug: string,
): ContentModuleCatalogEntry | undefined {
  const normalized = normalizeLawsSpecialtySlug(specialtySlug);
  return modules.find(
    (module) =>
      module.kind === 'regulatory' &&
      module.specialties.some((specialty) => normalizeLawsSpecialtySlug(specialty) === normalized),
  );
}

const CATALOG_ROUTE_ROOT = '#/modules/documents';
const COLLECTION_GROUPS: ReadonlySet<string> = new Set(['reference', 'regulatory', 'tool']);
const FIXED_GROUP_HASHES: Readonly<Record<string, string>> = {
  conditions: `${CATALOG_ROUTE_ROOT}/conditions`,
  medications: `${CATALOG_ROUTE_ROOT}/medications`,
  recommendations: `${CATALOG_ROUTE_ROOT}/recommendations`,
};

/** Where a downloaded catalog section is read: its own page, a collection or a category. */
export function catalogGroupHash(groupId: string): string {
  const fixed = FIXED_GROUP_HASHES[groupId];
  if (fixed) return fixed;
  const kind = COLLECTION_GROUPS.has(groupId) ? 'collection' : 'category';
  return `${CATALOG_ROUTE_ROOT}/${kind}/${encodeURIComponent(groupId)}`;
}

/** Where a single downloaded set is read, following how the catalog groups that kind of set. */
export function moduleCatalogHash(module: ContentModuleCatalogEntry): string {
  switch (module.kind) {
    case 'clinical':
      return catalogGroupHash(module.collection);
    case 'medication':
      return catalogGroupHash('medications');
    case 'regulatory':
      return lawsRouteForModule(module) ?? catalogGroupHash('regulatory');
    case 'reference':
    case 'tool':
      return catalogGroupHash(module.kind);
    default:
      return CATALOG_ROUTE_ROOT;
  }
}
