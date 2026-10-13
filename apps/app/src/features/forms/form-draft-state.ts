import type { FormDraftStatus } from '@/features/forms/form-session';

export interface FormDraftStateInput {
  readonly status: FormDraftStatus;
  /** ISO time of the approval. */
  readonly savedAt?: string | undefined;
  /** Why the last autosave failed. */
  readonly error?: string | undefined;
  /** Something has been typed: an untouched form is only «Черновик», nothing is stored. */
  readonly touched?: boolean | undefined;
  /** The draft cannot be written anywhere and is lost when the app closes. */
  readonly memoryOnly?: boolean | undefined;
}

/** The quiet state line of a form: «Черновик», «Сохранено · 8 окт., 14:32», or the save problem. */
export function formDraftStateText(input: FormDraftStateInput): string {
  if (input.error) return input.error;
  if (input.status === 'draft') {
    if (!input.touched) return 'Черновик';
    return input.memoryOnly ? 'Черновик · до закрытия приложения' : 'Черновик сохранён';
  }
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
