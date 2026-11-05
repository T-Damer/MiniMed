import { PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';

/**
 * A conversation handed from a finished recording to the form the doctor picked (FORMFILL1). The
 * recording dialog leaves the transcript here and opens the form; the form's «Беседа» sheet takes it
 * once and opens on the proposed values. Patient words stay in memory only, and go the moment the
 * patient vault locks.
 */
export interface HandedConversation {
  readonly sourceId: string;
  readonly label: string;
  readonly lines: readonly string[];
}

let pending: HandedConversation | undefined;

if (typeof window !== 'undefined') {
  window.addEventListener(PATIENT_VAULT_LOCK_EVENT, () => {
    pending = undefined;
  });
}

export function handOffConversation(conversation: HandedConversation): void {
  pending = conversation;
}

/** The conversation handed to this form, once; undefined when there is none for it. */
export function takeHandedConversation(sourceId: string): HandedConversation | undefined {
  if (pending?.sourceId !== sourceId) return undefined;
  const conversation = pending;
  pending = undefined;
  return conversation;
}
