import type { FormValue } from '@/features/forms/form-values';

/** `draft`: autosaved, still being filled. `saved`: the doctor pressed «Сохранить» and approved it. */
export type FormDraftStatus = 'draft' | 'saved';

/** What a person typed into one form for one patient and episode, and whether it is approved. */
export interface FormDraft {
  readonly edits: Readonly<Record<string, FormValue>>;
  readonly status: FormDraftStatus;
  /** ISO time of the last change. */
  readonly updatedAt: string;
  /** ISO time of the approval; only on a `saved` draft. */
  readonly savedAt?: string;
}

/**
 * Drafts kept in memory while the app is open, so that leaving the screen (to look at a patient
 * card, say) does not lose them even when nothing is written yet. They hold patient data: they are
 * persisted only inside the encrypted patient vault (`form-draft-store.ts`) and are dropped from
 * memory the moment the vault locks.
 */
const sessions = new Map<string, FormDraft>();

export function formSessionKey(
  formId: string,
  patientId: string | undefined,
  episodeId: string | undefined,
): string {
  return JSON.stringify([formId, patientId ?? '', episodeId ?? '']);
}

export function readFormSession(key: string): FormDraft | undefined {
  return sessions.get(key);
}

export function writeFormSession(key: string, draft: FormDraft): void {
  // An untouched draft is the same as no draft at all.
  if (draft.status === 'draft' && Object.keys(draft.edits).length === 0) sessions.delete(key);
  else sessions.set(key, draft);
}

export function clearFormSessions(): void {
  sessions.clear();
}
