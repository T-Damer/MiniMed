import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { PatientAvatarPicker } from '@/components/PatientAvatarPicker';
import { TextField } from '@/components/TextField';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import { createPatientInVault } from '@/state/patient-vault';
import type { PatientAvatar } from '@/state/patientAvatar';

import '@/components/PatientQuickCreate.css';

export function PatientQuickCreate(props: {
  readonly initialName: string;
  readonly onCreated: (snapshot: PatientVaultSnapshot, patientId: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.initialName);
  const [avatar, setAvatar] = createSignal<PatientAvatar>();
  const [avatarBusy, setAvatarBusy] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let current = true;
  onCleanup(() => {
    current = false;
  });
  const create = async (): Promise<void> => {
    if (busy() || avatarBusy() || !name().trim()) return;
    setBusy(true);
    setError('');
    try {
      const selectedAvatar = avatar();
      const created = await createPatientInVault({
        displayName: name(),
        ...(selectedAvatar ? { avatar: selectedAvatar } : {}),
      });
      if (current) props.onCreated(created.snapshot, created.patientId);
    } catch (cause) {
      if (current)
        setError(cause instanceof Error ? cause.message : 'Не удалось создать пациента.');
    } finally {
      if (current) setBusy(false);
    }
  };
  return (
    <fieldset class="patient-quick-create" aria-label="Добавить пациента">
      <div class="patient-quick-create__identity">
        <PatientAvatarPicker
          name={name()}
          value={avatar()}
          onBusyChange={setAvatarBusy}
          onChange={(value) => {
            setAvatar(value);
          }}
        />
        <TextField
          class="patient-quick-create__name"
          label="Имя или псевдоним"
          placeholder="Например: Иванова А. К."
          autocomplete="off"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              void create();
            }
          }}
        />
      </div>
      <Show when={error()}>
        <p class="patient-quick-create__error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="patient-quick-create__actions">
        <Button
          type="button"
          variant="icon"
          class="patient-quick-create__back"
          aria-label="Назад к списку"
          title="Назад к списку"
          icon={<AppGlyph name="caret-left" />}
          disabled={busy()}
          onClick={props.onCancel}
        />
        <Button
          type="button"
          variant="primary"
          class="patient-quick-create__submit"
          disabled={busy() || avatarBusy() || !name().trim()}
          onClick={() => void create()}
        >
          {busy() ? 'Создаём…' : 'Создать пациента'}
        </Button>
      </div>
    </fieldset>
  );
}
