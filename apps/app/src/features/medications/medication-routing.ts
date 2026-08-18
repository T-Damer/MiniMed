export const MEDICATION_CATALOG_HASH = '#/modules/documents/medications';
export const MEDICATION_CATALOG_ROUTE = 'modules/documents/medications';

export function isMedicationCatalogRoute(hashOrRoute: string): boolean {
  const route = hashOrRoute.replace(/^#\/?/u, '');
  return route === MEDICATION_CATALOG_ROUTE || route.startsWith(`${MEDICATION_CATALOG_ROUTE}/`);
}

export function legacyMedicationRegistrationFromHash(hash: string): string | null {
  const route = hash.replace(/^#\/?/u, '');
  const prefix = `${MEDICATION_CATALOG_ROUTE}/`;
  if (!route.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(route.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}
