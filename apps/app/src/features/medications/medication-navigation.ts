import type { MedicationProduct } from '@/features/medications/medication-record';
import { readableMedicationDocumentId } from '@/features/medications/medication-record';
import { MEDICATION_CATALOG_HASH } from '@/features/medications/medication-routing';
import { openDocumentOverlay } from '@/state/document-navigation';

interface PendingMedicationProduct {
  readonly documentId: string;
  readonly product: MedicationProduct;
}

/** History-state key: the catalog product stays with its document entry across reloads. */
const HISTORY_PRODUCT_KEY = 'medicationProduct';

let pendingMedicationProduct: PendingMedicationProduct | null = null;

export function queueMedicationProductContext(product: MedicationProduct): string | null {
  const documentId = readableMedicationDocumentId(product);
  pendingMedicationProduct = documentId ? { documentId, product } : null;
  return documentId;
}

export function consumeMedicationProductContext(documentId: string): MedicationProduct | null {
  const pending = pendingMedicationProduct;
  pendingMedicationProduct = null;
  return pending?.documentId === documentId ? pending.product : null;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isMedicationPresentation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const presentation = value as Record<string, unknown>;
  return (
    typeof presentation['dosageForm'] === 'string' &&
    isNullableString(presentation['strength']) &&
    isNullableString(presentation['route']) &&
    Array.isArray(presentation['packages']) &&
    presentation['packages'].every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const pack = item as Record<string, unknown>;
      return (
        typeof pack['description'] === 'string' && isNullableString(pack['prescriptionStatus'])
      );
    })
  );
}

function isMedicationProduct(value: unknown): value is MedicationProduct {
  if (!value || typeof value !== 'object') return false;
  const product = value as Record<string, unknown>;
  return (
    (product['sourceKind'] === 'allmed' ||
      product['sourceKind'] === 'esklp' ||
      product['sourceKind'] === 'grls') &&
    typeof product['registrationDocumentId'] === 'string' &&
    typeof product['registrationNumber'] === 'string' &&
    typeof product['tradeName'] === 'string' &&
    typeof product['inn'] === 'string' &&
    typeof product['registrationStatus'] === 'string' &&
    isNullableString(product['grlsRegistrationDocumentId']) &&
    isNullableString(product['instructionDocumentId']) &&
    isNullableString(product['mnnDocumentId']) &&
    isNullableString(product['linkedMnnDocumentId']) &&
    isNullableString(product['smnnCode']) &&
    isNullableString(product['shortDescription']) &&
    isNullableString(product['supplementalDescription']) &&
    isNullableString(product['prescriptionStatus']) &&
    isNullableString(product['holder']) &&
    isNullableString(product['manufacturer']) &&
    isNullableString(product['registrationDate']) &&
    (product['imageReference'] === undefined || typeof product['imageReference'] === 'string') &&
    isStringList(product['smnnCodes']) &&
    isStringList(product['klpCodes']) &&
    isStringList(product['pharmacotherapeuticGroups']) &&
    Array.isArray(product['presentations']) &&
    product['presentations'].every(isMedicationPresentation)
  );
}

/** Reads the product saved with the current history entry, e.g. after a page reload. */
export function medicationProductFromHistory(
  state: unknown,
  documentId: string,
): MedicationProduct | null {
  if (!state || typeof state !== 'object') return null;
  const saved = (state as Record<string, unknown>)[HISTORY_PRODUCT_KEY];
  if (!saved || typeof saved !== 'object') return null;
  const entry = saved as Record<string, unknown>;
  if (entry['documentId'] !== documentId) return null;
  return isMedicationProduct(entry['product']) ? entry['product'] : null;
}

/**
 * Saves the selected trade name (or, with `undefined`, the substance card) with the current history
 * entry, so a reload opens the same screen.
 */
export function rememberMedicationProduct(
  documentId: string,
  product: MedicationProduct | undefined,
): void {
  const state = window.history.state as Record<string, unknown> | null;
  window.history.replaceState(
    { ...state, [HISTORY_PRODUCT_KEY]: product ? { documentId, product } : null },
    '',
    window.location.href,
  );
}

export function openMedicationProduct(product: MedicationProduct): void {
  const documentId = queueMedicationProductContext(product);
  if (!documentId) return;
  openDocumentOverlay(documentId);
  rememberMedicationProduct(documentId, product);
}

let pendingCatalogQuery: string | null = null;

/** Opens the medication catalog with its search field filled, e.g. from a pharmacological group. */
export function openMedicationCatalogSearch(query: string): void {
  pendingCatalogQuery = query;
  window.location.hash = MEDICATION_CATALOG_HASH;
}

/** The query a link asked the catalog to start with; read once when the catalog mounts. */
export function consumeMedicationCatalogQuery(): string {
  const query = pendingCatalogQuery ?? '';
  pendingCatalogQuery = null;
  return query;
}
