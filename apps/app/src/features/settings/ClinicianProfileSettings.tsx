import { createSignal, For, type JSX, onCleanup, onMount } from 'solid-js';

import { TextField } from '@/components/TextField';
import {
  type ClinicianProfile,
  type ClinicianProfileKey,
  getClinicianProfile,
  setClinicianProfile,
  subscribeClinicianProfile,
  validateOgrn,
} from '@/state/clinician-profile';
import '@/styles/clinician-profile-settings.css';

const FIELDS: readonly {
  readonly key: ClinicianProfileKey;
  readonly label: string;
  readonly placeholder?: string;
  readonly inputMode?: 'numeric';
  readonly autocomplete: string;
}[] = [
  {
    key: 'organizationName',
    label: 'Наименование организации (или ФИО индивидуального предпринимателя)',
    autocomplete: 'organization',
  },
  { key: 'organizationAddress', label: 'Адрес организации', autocomplete: 'street-address' },
  {
    key: 'ogrn',
    label: 'ОГРН (ОГРНИП)',
    placeholder: '13 или 15 цифр',
    inputMode: 'numeric',
    autocomplete: 'off',
  },
  { key: 'clinicianFullName', label: 'ФИО врача', autocomplete: 'name' },
  { key: 'clinicianPosition', label: 'Должность и специальность врача', autocomplete: 'off' },
];

/** «Врач и организация»: device-local data that official forms fill in automatically. */
export function ClinicianProfileSettings(): JSX.Element {
  const [profile, setProfile] = createSignal<ClinicianProfile>(getClinicianProfile());
  const [ogrnError, setOgrnError] = createSignal<string>();

  onMount(() => {
    const unsubscribe = subscribeClinicianProfile(setProfile);
    onCleanup(unsubscribe);
  });

  const save = (key: ClinicianProfileKey, value: string): void => {
    if (key === 'ogrn') {
      const error = validateOgrn(value);
      setOgrnError(error);
      if (error) return;
    }
    setProfile(setClinicianProfile({ [key]: value }));
  };

  return (
    <section
      class="settings-section clinician-profile-settings paper-sheet"
      aria-label="Данные врача и организации"
    >
      <div class="clinician-profile-settings__fields">
        <For each={FIELDS}>
          {(field) => (
            <TextField
              class="clinician-profile-settings__field"
              label={field.label}
              value={profile()[field.key] ?? ''}
              placeholder={field.placeholder}
              inputMode={field.inputMode}
              autocomplete={field.autocomplete}
              error={field.key === 'ogrn' ? ogrnError() : undefined}
              onInput={field.key === 'ogrn' ? () => setOgrnError(undefined) : undefined}
              onChange={(event) => save(field.key, event.currentTarget.value)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
