/**
 * Where a prescription draft lives between visits (RX1). A draft with a patient holds patient data,
 * so it is written only as a file of the patient vault (encrypted with it, removed with the card);
 * a draft without a patient holds a drug list and an age and a weight, no identity, and sits in the
 * browser's own storage. While the vault is closed a patient's draft stays in memory only.
 */
import {
  PRESCRIPTION_DRAFT_VERSION,
  type PrescriptionDraft,
  parsePrescriptionDraft,
} from '@localmed/contracts';

import { addPatientBlob, isPatientVaultUnlocked, readPatientBlob } from '@/state/patient-vault';

const MIME = 'application/json';
const ANONYMOUS_KEY = 'minimed.prescription.draft';
const memory = new Map<string, PrescriptionDraft>();

export function emptyDraft(formId: string): PrescriptionDraft {
  return {
    kind: 'minimed-prescription-draft',
    version: PRESCRIPTION_DRAFT_VERSION,
    items: [],
    patient: {
      ageDays: null,
      group: null,
      weightKg: null,
      heightCm: null,
      pregnant: false,
      lactating: false,
    },
    formId,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

export function prescriptionBlobId(patientId: string): string {
  return `prescription-draft/${patientId}`;
}

function memoryKey(patientId: string | undefined): string {
  return patientId ?? '';
}

export function clearPrescriptionSessions(): void {
  memory.clear();
}

function readAnonymous(): PrescriptionDraft | undefined {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(ANONYMOUS_KEY);
  } catch {
    // Storage blocked (private window): there is no draft to read.
    return undefined;
  }
  // A damaged draft is reported to the caller, never half-read.
  return stored ? parsePrescriptionDraft(stored) : undefined;
}

function writeAnonymous(draft: PrescriptionDraft | undefined): void {
  try {
    if (draft === undefined) window.localStorage.removeItem(ANONYMOUS_KEY);
    else window.localStorage.setItem(ANONYMOUS_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft stays in memory for this visit.
  }
}

export async function loadPrescriptionDraft(
  patientId: string | undefined,
): Promise<PrescriptionDraft | undefined> {
  const remembered = memory.get(memoryKey(patientId));
  if (remembered) return remembered;
  if (!patientId) {
    const draft = readAnonymous();
    if (draft) memory.set(memoryKey(undefined), draft);
    return draft;
  }
  if (!isPatientVaultUnlocked()) return undefined;
  const blob = await readPatientBlob(prescriptionBlobId(patientId));
  if (!blob) return undefined;
  const draft = parsePrescriptionDraft(new TextDecoder().decode(blob.bytes));
  memory.set(memoryKey(patientId), draft);
  return draft;
}

export async function storePrescriptionDraft(
  patientId: string | undefined,
  draft: PrescriptionDraft,
): Promise<void> {
  const empty = draft.items.length === 0 && draft.status === 'draft';
  if (empty) memory.delete(memoryKey(patientId));
  else memory.set(memoryKey(patientId), draft);
  if (!patientId) {
    writeAnonymous(empty ? undefined : draft);
    return;
  }
  if (!isPatientVaultUnlocked()) return;
  await addPatientBlob({
    id: prescriptionBlobId(patientId),
    patientId,
    mimeType: MIME,
    bytes: new TextEncoder().encode(JSON.stringify(draft)),
  });
}
