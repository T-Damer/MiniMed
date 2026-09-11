import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { PatientAvatarPicker } from '@/components/PatientAvatarPicker';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import { createPatientInVault } from '@/state/patient-vault';
import type { PatientAvatar } from '@/state/patientAvatar';

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
    <fieldset class="patient-case-combobox__create" aria-label="Добавить пациента">
      <label class="patient-case-combobox__label">
        Имя или псевдоним
        <input
          class="patient-case-combobox__name"
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
      </label>
      <PatientAvatarPicker
        name={name()}
        value={avatar()}
        onBusyChange={setAvatarBusy}
        onChange={(value) => {
          setAvatar(value);
        }}
      />
      <button
        class="patient-case-combobox__action"
        type="button"
        disabled={busy() || avatarBusy() || !name().trim()}
        onClick={() => void create()}
      >
        {busy() ? 'Создаём…' : 'Создать пациента'}
      </button>
      <button
        class="patient-case-combobox__action"
        type="button"
        disabled={busy()}
        onClick={props.onCancel}
      >
        Назад к списку
      </button>
      <Show when={error()}>
        <p class="patient-case-combobox__error" role="alert">
          {error()}
        </p>
      </Show>
    </fieldset>
  );
}
