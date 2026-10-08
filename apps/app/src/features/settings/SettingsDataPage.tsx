import { type Accessor, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import {
  PATIENT_BACKUP_CONFIRMATION,
  saveNotesBackup,
  savePatientsBackup,
} from '@/features/settings/data-backup';
import {
  dataStatus,
  type PatientVaultState,
  patientStorageDescription,
} from '@/features/settings/settings-status';
import { PATIENT_VAULT_EVENT, patientVaultStorageMode } from '@/state/patient-vault';

/** One backup action: the whole row is the button, a download mark trails. */
function BackupRow(props: {
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly divided?: boolean;
  readonly onSave: () => void;
}): JSX.Element {
  return (
    <li class="settings-list__item">
      <button
        type="button"
        class="settings-list__row settings-list__row--action"
        classList={{ 'settings-list__row--divided': props.divided === true }}
        disabled={props.disabled === true || props.busy}
        onClick={props.onSave}
      >
        <span class="settings-tile settings-tile--teal">
          <AppGlyph name={props.icon} class="settings-tile__glyph" />
        </span>
        <span class="settings-list__title">{props.title}</span>
        <Show when={props.busy}>
          <span class="settings-list__status">Готовим…</span>
        </Show>
        <AppGlyph name="download" class="settings-list__chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

/** How the patient cards are stored right now; follows the vault while the page is open. */
function createPatientVaultState(): Accessor<PatientVaultState> {
  const [state, setState] = createSignal<PatientVaultState>('checking');
  onMount(() => {
    let disposed = false;
    const sync = (): void => {
      patientVaultStorageMode().then(
        (mode) => {
          if (!disposed) setState(mode ?? 'empty');
        },
        (cause: unknown) => {
          console.warn('Хранилище пациентов не прочитано.', cause);
        },
      );
    };
    sync();
    window.addEventListener(PATIENT_VAULT_EVENT, sync);
    onCleanup(() => {
      disposed = true;
      window.removeEventListener(PATIENT_VAULT_EVENT, sync);
    });
  });
  return state;
}

/** The «?» of the page: what protects the data, and what a backup file leaves open. */
export function SettingsDataHelp(): JSX.Element {
  const state = createPatientVaultState();
  return (
    <>
      <p>{patientStorageDescription(state())}</p>
      <p>
        Файл копии не шифруется: храните его так же бережно, как сами записи. Восстановить данные из
        копии можно в разделе заметок и в списке пациентов.
      </p>
    </>
  );
}

/**
 * «Пациенты и данные»: where personal data lives and the actions on it. Backups of notes and
 * patient cards are saved from here; what protects the data is explained behind the «?» of the page.
 */
export function SettingsDataPage(): JSX.Element {
  const state = createPatientVaultState();
  const [saving, setSaving] = createSignal<'notes' | 'patients' | null>(null);
  const save = async (
    kind: 'notes' | 'patients',
    run: () => Promise<void>,
    success: string,
  ): Promise<void> => {
    if (saving()) return;
    setSaving(kind);
    try {
      await run();
      toast.success(success);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить копию.');
    } finally {
      setSaving(null);
    }
  };
  const savePatients = (): void => {
    if (!window.confirm(PATIENT_BACKUP_CONFIRMATION)) return;
    void save('patients', savePatientsBackup, 'Карточки пациентов сохранены в файл.');
  };
  const status = () => dataStatus(state());
  return (
    <ul class="settings-list__group settings-data__group">
      <li class="settings-list__item">
        <div class="settings-list__row">
          <span class="settings-tile settings-tile--teal">
            <AppGlyph name="lock" class="settings-tile__glyph" />
          </span>
          <span class="settings-list__title">Хранилище</span>
          <span class={`settings-list__status settings-list__status--${status().tone}`}>
            <span
              class={`settings-list__dot settings-list__dot--${status().tone}`}
              aria-hidden="true"
            />
            <span class="settings-list__status-text" data-testid="patient-storage-description">
              {status().label}
            </span>
          </span>
        </div>
      </li>
      <BackupRow
        icon="notes"
        title="Копия личных заметок"
        busy={saving() === 'notes'}
        disabled={saving() !== null}
        divided
        onSave={() => void save('notes', saveNotesBackup, 'Личные заметки сохранены в файл.')}
      />
      <BackupRow
        icon="users"
        title="Копия карточек пациентов"
        busy={saving() === 'patients'}
        disabled={saving() !== null || state() === 'empty' || state() === 'checking'}
        divided
        onSave={savePatients}
      />
    </ul>
  );
}
