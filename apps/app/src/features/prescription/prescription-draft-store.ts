/**
 * Where a prescription draft lives between visits (RX1). A draft with a patient holds patient data,
 * so it is written only as a file of the patient vault (encrypted with it, removed with the card);
 * a draft without a patient holds a drug list and an age and a weight, no identity, and sits in the
 * browser's own storage. While the vault is closed a patient's draft stays in memory only.
 *
 * Every change is remembered at once (`rememberPrescriptionDraft`): a draft without a patient goes
 * to browser storage on the spot, a patient's draft is also sealed with the vault key into a
 * write-ahead copy (`prescriptionDraftCopies`, `state/draft-write-ahead.ts`). The vault write
 * follows after the typing pauses; a reload inside that window is restored from the copy by
 * `loadPrescriptionDraft`.
 */
import {
  PRESCRIPTION_DRAFT_VERSION,
  type PrescriptionDraft,
  parsePrescriptionDraft,
} from '@localmed/contracts';

import { createDraftWriteAheadStore } from '@/state/draft-write-ahead';
import {
  addPatientBlob,
  isPatientVaultUnlocked,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientBlob,
} from '@/state/patient-vault';

const MIME = 'application/json';
const ANONYMOUS_KEY = 'minimed.prescription.draft';
const memory = new Map<string, PrescriptionDraft>();

export const PRESCRIPTION_WRITE_AHEAD_KEY = 'minimed.prescription-draft-ahead.v1';

export const prescriptionDraftCopies = createDraftWriteAheadStore({
  storageKey: PRESCRIPTION_WRITE_AHEAD_KEY,
  sealType: 'prescription-draft-ahead',
  label: 'Prescription draft',
});

/** Drops the copies of patients that no longer exist (`patientIds` are those of the open vault). */
export function prunePrescriptionDraftCopies(patientIds: ReadonlySet<string>): void {
  prescriptionDraftCopies.prune((owner) => patientIds.has(owner.patientId));
}

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

/** A draft with no drug and none of the patient's facts typed is the same as no draft. */
export function isUntouchedDraft(draft: PrescriptionDraft): boolean {
  const { patient } = draft;
  return (
    draft.items.length === 0 &&
    draft.status === 'draft' &&
    patient.ageDays === null &&
    patient.group === null &&
    patient.weightKg === null &&
    patient.heightCm === null &&
    !patient.pregnant &&
    !patient.lactating
  );
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

let lockGuardInstalled = false;

/** Locking the vault drops every patient's draft from memory; a draft without a patient stays. */
function installLockGuard(): void {
  if (lockGuardInstalled || typeof window === 'undefined') return;
  lockGuardInstalled = true;
  window.addEventListener(PATIENT_VAULT_LOCK_EVENT, () => {
    for (const key of [...memory.keys()]) if (key !== memoryKey(undefined)) memory.delete(key);
  });
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

/**
 * The write-ahead copy a reload left, when it is newer than what the vault holds: it becomes the
 * stored draft and its copy goes. Without a newer copy the stored draft stands.
 */
async function restoreDraftCopy(
  patientId: string,
  stored: PrescriptionDraft | undefined,
): Promise<PrescriptionDraft | undefined> {
  const copy = await prescriptionDraftCopies.read(patientId, null);
  if (!copy) return stored;
  const copyId = prescriptionDraftCopies.entryId(patientId, null);
  let restored: PrescriptionDraft;
  try {
    restored = parsePrescriptionDraft(copy.text);
  } catch {
    // A copy of an older format: nothing can read it.
    console.warn('Prescription draft write-ahead copy dropped: it cannot be read.');
    prescriptionDraftCopies.remove([copyId]);
    return stored;
  }
  if (stored && stored.updatedAt > restored.updatedAt) {
    prescriptionDraftCopies.remove([copyId]);
    return stored;
  }
  try {
    await storePrescriptionDraft(patientId, restored);
    prescriptionDraftCopies.remove([copyId]);
  } catch (cause) {
    // The copy stays for the next open; the person still sees what they typed.
    console.warn(
      'Prescription draft restored from its write-ahead copy, vault write failed:',
      cause instanceof Error ? cause.message : 'storage error',
    );
  }
  return restored;
}

export async function loadPrescriptionDraft(
  patientId: string | undefined,
): Promise<PrescriptionDraft | undefined> {
  installLockGuard();
  const remembered = memory.get(memoryKey(patientId));
  if (remembered) return remembered;
  if (!patientId) {
    const draft = readAnonymous();
    if (draft) memory.set(memoryKey(undefined), draft);
    return draft;
  }
  if (!isPatientVaultUnlocked()) return undefined;
  const blob = await readPatientBlob(prescriptionBlobId(patientId));
  const stored = blob ? parsePrescriptionDraft(new TextDecoder().decode(blob.bytes)) : undefined;
  const draft = await restoreDraftCopy(patientId, stored);
  if (draft) memory.set(memoryKey(patientId), draft);
  return draft;
}

/**
 * The part of storing a draft that needs no waiting: memory, and browser storage for a draft
 * without a patient. Called at every change, before the vault write.
 */
export function rememberPrescriptionDraft(
  patientId: string | undefined,
  draft: PrescriptionDraft,
): void {
  installLockGuard();
  const empty = isUntouchedDraft(draft);
  if (empty) memory.delete(memoryKey(patientId));
  else memory.set(memoryKey(patientId), draft);
  if (!patientId) writeAnonymous(empty ? undefined : draft);
}

export async function storePrescriptionDraft(
  patientId: string | undefined,
  draft: PrescriptionDraft,
): Promise<void> {
  rememberPrescriptionDraft(patientId, draft);
  if (!patientId || !isPatientVaultUnlocked()) return;
  await addPatientBlob({
    id: prescriptionBlobId(patientId),
    patientId,
    mimeType: MIME,
    bytes: new TextEncoder().encode(JSON.stringify(draft)),
  });
}
