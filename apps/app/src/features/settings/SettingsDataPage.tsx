import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  type PatientVaultState,
  patientStorageDescription,
} from '@/features/settings/settings-status';
import { PATIENT_VAULT_EVENT, patientVaultStorageMode } from '@/state/patient-vault';

/**
 * «Пациенты и данные»: where personal data lives. Backups of notes and patient cards are made in
 * the notes section; this page explains the storage and leads there.
 */
export function SettingsDataPage(): JSX.Element {
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
  return (
    <>
      <section
        class="settings-section settings-section--data paper-sheet"
        aria-labelledby="settings-data-storage-heading"
      >
        <div class="settings-section__heading">
          <div class="settings-section__heading-main">
            <AppGlyph name="lock" class="settings-section__icon" />
            <div class="settings-section__heading-copy">
              <h3 id="settings-data-storage-heading" class="settings-section__title">
                Хранилище пациентов
              </h3>
              <p class="settings-section__description" data-testid="patient-storage-description">
                {patientStorageDescription(state())}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section
        class="settings-section settings-section--data paper-sheet"
        aria-labelledby="settings-data-backup-heading"
      >
        <div class="settings-section__heading">
          <div class="settings-section__heading-main">
            <AppGlyph name="file-arrow-down" class="settings-section__icon" />
            <div class="settings-section__heading-copy">
              <h3 id="settings-data-backup-heading" class="settings-section__title">
                Резервная копия
              </h3>
              <p class="settings-section__description">
                Копия личных заметок и вложений делается в разделе заметок: кнопка «Данные личных
                заметок», пункты «Экспорт backup заметок» и «Импорт backup заметок». Файл копии не
                шифруется, храните его так же бережно, как сами записи.
              </p>
            </div>
          </div>
        </div>
        <a class="settings-section__link" href="#/notes">
          Открыть заметки
        </a>
      </section>
    </>
  );
}
