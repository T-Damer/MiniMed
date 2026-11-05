import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import {
  type NewPatientDraft,
  newPatientDraftTitle,
} from '@/features/diary/dashboard/new-patient-drafts';

function edited(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The top of the patient list (owner 2026-11-05): «Создать пациента» whatever the list holds, and
 * under it a card for each new patient begun and not created yet, which opens the form where the
 * doctor left it.
 */
export function NewPatientShelf(props: {
  readonly drafts: readonly NewPatientDraft[];
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
  readonly onDiscard: (id: string) => void;
}): JSX.Element {
  const [discarding, setDiscarding] = createSignal<NewPatientDraft>();
  return (
    <div class="diary-new-shelf">
      <button
        type="button"
        class="diary-new-shelf__create"
        data-testid="diary-create-patient"
        onClick={() => props.onCreate()}
      >
        <span class="diary-new-shelf__create-icon" aria-hidden="true">
          <AppGlyph name="plus" class="diary-new-shelf__create-glyph" />
        </span>
        Создать пациента
      </button>
      <Show when={props.drafts.length}>
        <ul class="diary-new-shelf__drafts" aria-label="Черновики пациентов">
          <For each={props.drafts}>
            {(draft) => (
              <li class="diary-new-draft" data-testid="diary-new-draft" data-draft-id={draft.id}>
                <button
                  type="button"
                  class="diary-new-draft__open"
                  aria-label={`Продолжить: ${newPatientDraftTitle(draft)}`}
                  onClick={() => props.onOpen(draft.id)}
                >
                  <span class="diary-new-draft__avatar" aria-hidden="true">
                    {draft.emoji || '🙂'}
                  </span>
                  <span class="diary-new-draft__text">
                    <span class="diary-new-draft__name">{newPatientDraftTitle(draft)}</span>
                    <span class="diary-new-draft__meta">
                      <span class="diary-new-draft__badge">Черновик</span>
                      {edited(draft.savedAt)}
                    </span>
                  </span>
                  <AppGlyph name="edit" class="diary-new-draft__glyph" />
                </button>
                <button
                  type="button"
                  class="diary-new-draft__discard"
                  aria-label={`Удалить черновик: ${newPatientDraftTitle(draft)}`}
                  onClick={() => setDiscarding(draft)}
                >
                  <AppGlyph name="trash" class="diary-new-draft__discard-glyph" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <ConfirmationDialog
        open={discarding() !== undefined}
        title="Удалить черновик?"
        description={<p>Введённое для этого пациента пропадёт.</p>}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          const draft = discarding();
          setDiscarding(undefined);
          if (draft) props.onDiscard(draft.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDiscarding(undefined);
        }}
      />
    </div>
  );
}
