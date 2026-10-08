import { z } from 'zod';

import {
  type FormDraft,
  formSessionKey,
  readFormSession,
  writeFormSession,
} from '@/features/forms/form-session';
import { addPatientBlob, isPatientVaultUnlocked, readPatientBlob } from '@/state/patient-vault';

/**
 * Where a form draft lives between visits. A draft holds patient data, so it is written only as a
 * file of the patient vault (encrypted with it, removed with the card, carried by the card
 * backup) and never to ordinary storage. While the vault is closed — a blank form without a
 * patient — the draft stays in memory only.
 */

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

/** The draft of a form: memory first, then the vault when it is open. */
export async function loadFormDraft(target: FormDraftTarget): Promise<FormDraft | undefined> {
  const key = formSessionKey(target.formId, target.patientId, target.episodeId);
  const remembered = readFormSession(key);
  if (remembered) return remembered;
  if (!isPatientVaultUnlocked()) return undefined;
  const blob = await readPatientBlob(formDraftBlobId(target));
  if (!blob) return undefined;
  const draft = parseFormDraft(new TextDecoder().decode(blob.bytes));
  writeFormSession(key, draft);
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
