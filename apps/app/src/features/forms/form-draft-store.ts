import { z } from 'zod';

import {
  type FormDraft,
  formSessionKey,
  readFormSession,
  writeFormSession,
} from '@/features/forms/form-session';
import { createDraftWriteAheadStore } from '@/state/draft-write-ahead';
import { addPatientBlob, isPatientVaultUnlocked, readPatientBlob } from '@/state/patient-vault';

/**
 * Where a form draft lives between visits. A draft holds patient data, so it is written only as a
 * file of the patient vault (encrypted with it, removed with the card, carried by the card
 * backup) and never to ordinary storage. While the vault is closed — a blank form without a
 * patient — the draft stays in memory only.
 *
 * Every change is also sealed with the vault key into a write-ahead copy at once
 * (`formDraftCopies`, `state/draft-write-ahead.ts`). The vault write follows after the typing
 * pauses; a reload or an app kill inside that window is restored from the copy by `loadFormDraft`.
 */

export const FORM_DRAFT_WRITE_AHEAD_KEY = 'minimed.form-draft-ahead.v1';

export const formDraftCopies = createDraftWriteAheadStore({
  storageKey: FORM_DRAFT_WRITE_AHEAD_KEY,
  sealType: 'form-draft-ahead',
  label: 'Form draft',
});

export const FORM_DRAFT_SCHEMA_VERSION = 1 as const;
const MIME = 'application/json';
const ISO_INSTANT = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'must be an ISO date-time',
});

const FormValueSchema = z.union([z.string(), z.boolean(), z.array(z.string())]);

const StoredFormDraftSchema = z
  .object({
    kind: z.literal('minimed-form-draft'),
    schemaVersion: z.literal(FORM_DRAFT_SCHEMA_VERSION),
    edits: z.record(z.string(), FormValueSchema),
    status: z.enum(['draft', 'saved']),
    updatedAt: ISO_INSTANT,
    savedAt: ISO_INSTANT.optional(),
  })
  .strict();

export class FormDraftError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FormDraftError';
  }
}

export interface FormDraftTarget {
  readonly formId: string;
  readonly patientId?: string | undefined;
  readonly episodeId?: string | undefined;
}

export function formDraftBlobId(target: FormDraftTarget): string {
  return `form-draft/${target.formId}/${target.patientId || '-'}/${target.episodeId || '-'}`;
}

export function serializeFormDraft(draft: FormDraft): string {
  return JSON.stringify({
    kind: 'minimed-form-draft',
    schemaVersion: FORM_DRAFT_SCHEMA_VERSION,
    edits: draft.edits,
    status: draft.status,
    updatedAt: draft.updatedAt,
    ...(draft.savedAt ? { savedAt: draft.savedAt } : {}),
  });
}

/** Validates stored text; a damaged draft is reported, never half-read. */
export function parseFormDraft(text: string): FormDraft {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new FormDraftError('Черновик формы повреждён.', { cause });
  }
  const parsed = StoredFormDraftSchema.safeParse(value);
  if (!parsed.success) throw new FormDraftError('Черновик формы повреждён.');
  const { edits, status, updatedAt, savedAt } = parsed.data;
  return { edits, status, updatedAt, ...(savedAt ? { savedAt } : {}) };
}

/**
 * Whose write-ahead copy a draft is: the patient (empty for a blank form) and the form with its
 * episode. The same pair is used by the filling screen when it writes the copy.
 */
export function formDraftCopyOwner(target: FormDraftTarget): {
  readonly patientId: string;
  readonly targetId: string;
} {
  return {
    patientId: target.patientId ?? '',
    targetId: `${target.formId}/${target.episodeId || '-'}`,
  };
}

/** Drops the copies of patients that no longer exist (`patientIds` are those of the open vault). */
export function pruneFormDraftCopies(patientIds: ReadonlySet<string>): void {
  formDraftCopies.prune((owner) => owner.patientId === '' || patientIds.has(owner.patientId));
}

/**
 * The write-ahead copy a reload left, when it is newer than what the vault holds: it becomes the
 * stored draft and its copy goes. Without a newer copy the stored draft stands.
 */
async function restoreFormDraftCopy(
  target: FormDraftTarget,
  stored: FormDraft | undefined,
): Promise<FormDraft | undefined> {
  const owner = formDraftCopyOwner(target);
  const copy = await formDraftCopies.read(owner.patientId, owner.targetId);
  if (!copy) return stored;
  const copyId = formDraftCopies.entryId(owner.patientId, owner.targetId);
  let restored: FormDraft;
  try {
    restored = parseFormDraft(copy.text);
  } catch {
    // A copy of an older format: nothing can read it.
    console.warn('Form draft write-ahead copy dropped: it cannot be read.');
    formDraftCopies.remove([copyId]);
    return stored;
  }
  if (stored && stored.updatedAt > restored.updatedAt) {
    formDraftCopies.remove([copyId]);
    return stored;
  }
  try {
    await storeFormDraft(target, restored);
    formDraftCopies.remove([copyId]);
  } catch (cause) {
    // The copy stays for the next open; the person still sees what they typed.
    console.warn(
      'Form draft restored from its write-ahead copy, vault write failed:',
      cause instanceof Error ? cause.message : 'storage error',
    );
  }
  return restored;
}

/** The draft of a form: memory first, then the vault when it is open, then a newer copy. */
export async function loadFormDraft(target: FormDraftTarget): Promise<FormDraft | undefined> {
  const key = formSessionKey(target.formId, target.patientId, target.episodeId);
  const remembered = readFormSession(key);
  if (remembered) return remembered;
  if (!isPatientVaultUnlocked()) return undefined;
  const blob = await readPatientBlob(formDraftBlobId(target));
  const stored = blob ? parseFormDraft(new TextDecoder().decode(blob.bytes)) : undefined;
  const draft = await restoreFormDraftCopy(target, stored);
  if (draft) writeFormSession(key, draft);
  return draft;
}

/** Remembers the draft and, with the vault open, writes it to the vault. */
export async function storeFormDraft(target: FormDraftTarget, draft: FormDraft): Promise<void> {
  writeFormSession(formSessionKey(target.formId, target.patientId, target.episodeId), draft);
  if (!isPatientVaultUnlocked()) return;
  await addPatientBlob({
    id: formDraftBlobId(target),
    ...(target.patientId ? { patientId: target.patientId } : {}),
    mimeType: MIME,
    bytes: new TextEncoder().encode(serializeFormDraft(draft)),
  });
}
