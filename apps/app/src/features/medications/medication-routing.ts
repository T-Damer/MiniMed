import { atcPrefixes, normalizeAtcCode } from '@/features/medications/atc-code';

export const MEDICATION_CATALOG_HASH = '#/modules/documents/medications';
export const MEDICATION_CATALOG_ROUTE = 'modules/documents/medications';

/** The «По группам АТХ» view: `…/medications/atc` (the groups) and `…/medications/atc/<code>`. */
export const MEDICATION_ATC_ROUTE = `${MEDICATION_CATALOG_ROUTE}/atc`;
export const MEDICATION_ATC_HASH = `#/${MEDICATION_ATC_ROUTE}`;

/** The synthetic group of substances without an ATC code. */
export const ATC_NONE_CODE = 'none';

/** `N06BX` → `['N', 'N06', 'N06B', 'N06BX']`: the way down to a node, for the breadcrumbs. */
export function atcCrumbCodes(code: string): readonly string[] {
  if (code === ATC_NONE_CODE) return [code];
  return atcPrefixes(code)
    .filter((prefix) => prefix.level <= 4)
    .map((prefix) => prefix.code);
}

/** The group one level up; null for level 1 (the list of groups). */
export function atcParentCode(code: string): string | null {
  const crumbs = atcCrumbCodes(code);
  return crumbs.length > 1 ? (crumbs.at(-2) ?? null) : null;
}

export function isMedicationCatalogRoute(hashOrRoute: string): boolean {
  const route = hashOrRoute.replace(/^#\/?/u, '');
  return route === MEDICATION_CATALOG_ROUTE || route.startsWith(`${MEDICATION_CATALOG_ROUTE}/`);
}

export type MedicationCatalogView =
  | { readonly view: 'list' }
  /** The ATC tree; `code` is the open node (levels 1-4, or `none`), null for the list of groups. */
  | { readonly view: 'atc'; readonly code: string | null };

/** `#/modules/documents/medications/atc/N06B` → the ATC tree at `N06B`; anything else is the list. */
export function medicationCatalogViewFromHash(hash: string): MedicationCatalogView {
  const route = hash.replace(/^#\/?/u, '').replace(/[?#].*$/u, '');
  if (route === MEDICATION_ATC_ROUTE) return { view: 'atc', code: null };
  const prefix = `${MEDICATION_ATC_ROUTE}/`;
  if (!route.startsWith(prefix)) return { view: 'list' };
  let raw: string;
  try {
    raw = decodeURIComponent(route.slice(prefix.length));
  } catch {
    return { view: 'atc', code: null };
  }
  if (raw === ATC_NONE_CODE) return { view: 'atc', code: ATC_NONE_CODE };
  const normalized = normalizeAtcCode(raw);
  return {
    view: 'atc',
    code: normalized && normalized.level <= 4 ? normalized.code : null,
  };
}

/** The address of the tree at a node, or of the list of groups for null. */
export function medicationAtcHash(code: string | null): string {
  return code ? `${MEDICATION_ATC_HASH}/${encodeURIComponent(code)}` : MEDICATION_ATC_HASH;
}

export function legacyMedicationRegistrationFromHash(hash: string): string | null {
  const route = hash.replace(/^#\/?/u, '');
  const prefix = `${MEDICATION_CATALOG_ROUTE}/`;
  if (!route.startsWith(prefix)) return null;
  if (route === MEDICATION_ATC_ROUTE || route.startsWith(`${MEDICATION_ATC_ROUTE}/`)) return null;
  try {
    return decodeURIComponent(route.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}
