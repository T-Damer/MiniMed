import type { FormDraftStatus } from '@/features/forms/form-session';

export interface FormDraftStateInput {
  readonly status: FormDraftStatus;
  /** ISO time of the approval. */
  readonly savedAt?: string | undefined;
  /** Why the last autosave failed. */
  readonly error?: string | undefined;
}

/** The quiet state line of a form: «Черновик», «Сохранено · 8 окт., 14:32», or the save problem. */
export function formDraftStateText(input: FormDraftStateInput): string {
  if (input.error) return input.error;
  if (input.status === 'draft') return 'Черновик';
  const when = input.savedAt ? new Date(input.savedAt) : undefined;
  if (!when || Number.isNaN(when.getTime())) return 'Сохранено';
  const text = when.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Сохранено · ${text}`;
}
