import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { DiaryCareEditor } from '@/features/diary/DiaryCareEditor';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import { type CareDraft, careInvitation, emptyCareDraft } from '@/features/diary/diary-care-draft';

export const PATIENT_EMOJIS = [
  '🦊',
  '🐻',
  '🐼',
  '🦉',
  '🐬',
  '🌻',
  '🍀',
  '⭐',
  '🌙',
  '🐢',
  '🦋',
  '🍎',
];

export function EmojiPicker(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <fieldset class="diary-emoji">
      <legend class="diary-emoji__legend">Значок</legend>
      <For each={PATIENT_EMOJIS}>
        {(emoji) => (
          <button
            type="button"
            class="diary-emoji__option"
            classList={{ 'diary-emoji__option--on': props.value === emoji }}
            aria-pressed={props.value === emoji}
            onClick={() => props.onChange(emoji)}
          >
            {emoji}
          </button>
        )}
      </For>
    </fieldset>
  );
}

/**
 * A new connected patient: a pseudonym and an emoji (no real name is needed on the server), the
 * day plan, then the one-time code for the patient's phone.
 */
export function NewPatientDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly onClose: () => void;
  readonly onCreated: (id: string) => void;
}): JSX.Element {
  const [label, setLabel] = createSignal('');
  const [emoji, setEmoji] = createSignal(PATIENT_EMOJIS[0] ?? '🙂');
  const [draft, setDraft] = createSignal<CareDraft>(emptyCareDraft());
  const [doctor, setDoctor] = createSignal(props.workspace.session.doctor.name);
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [created, setCreated] = createSignal<string>();

  const create = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    if (!label().trim()) {
      setError('Как называть пациента в списке? Подойдёт псевдоним.');
      return;
    }
    setBusy(true);
    try {
      const id = await props.workspace.createPatient(
        { label: label().trim(), emoji: emoji() },
        (patientId) =>
          careInvitation({ id: patientId, draft: draft(), doctor: doctor(), note: note() }),
      );
      setCreated(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать пациента.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDialog
      open
      title={created() ? 'Подключите телефон пациента' : 'Новый пациент'}
      class="diary-dash-dialog"
      onClose={props.onClose}
    >
      <Show
        when={created()}
        fallback={
          <form class="diary-dash-form" onSubmit={(event) => void create(event)}>
            <TextField
              label="Имя или псевдоним"
              placeholder="Например: Лиса, А. К."
              value={label()}
              onInput={(event) => setLabel(event.currentTarget.value)}
            />
            <EmojiPicker value={emoji()} onChange={setEmoji} />
            <DiaryCareEditor draft={draft()} onChange={setDraft} />
            <TextField
              label="Врач (видит пациент)"
              value={doctor()}
              onInput={(event) => setDoctor(event.currentTarget.value)}
            />
            <TextArea
              label="Инструкция пациенту"
              maxLength={200}
              value={note()}
              onInput={(event) => setNote(event.currentTarget.value)}
            />
            <Show when={error()}>
              <p class="diary-dash__error" role="alert">
                {error()}
              </p>
            </Show>
            <Button type="submit" variant="primary" disabled={busy()}>
              {busy() ? 'Шифруем и сохраняем…' : 'Создать и показать код'}
            </Button>
          </form>
        }
      >
        {(id) => (
          <PairingView
            workspace={props.workspace}
            patientId={id()}
            onDone={() => {
              props.onCreated(id());
              props.onClose();
            }}
          />
        )}
      </Show>
    </OverlayDialog>
  );
}
