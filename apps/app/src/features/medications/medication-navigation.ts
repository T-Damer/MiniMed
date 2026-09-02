import type { MedicationProduct } from '@/features/medications/medication-record';
import { readableMedicationDocumentId } from '@/features/medications/medication-record';
import { openDocumentOverlay } from '@/state/document-navigation';

interface PendingMedicationProduct {
  readonly documentId: string;
  readonly product: MedicationProduct;
}

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

export function openMedicationProduct(product: MedicationProduct): void {
  const documentId = queueMedicationProductContext(product);
  if (documentId) openDocumentOverlay(documentId);
}
