import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

import { openEncryptedVault } from '@/features/conversations/conversation-transcript';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

/**
 * The patients a recording can go to, for the picker row in the recorder window and the recording
 * sheet. On a phone the encrypted vault opens with its device key; nothing is asked of the doctor.
 * `null` while the vault is closed (the picker then offers to open it).
 */
export function usePatientSnapshot(onError: (message: string) => void): {
  readonly snapshot: Accessor<PatientVaultSnapshot | null>;
  readonly setSnapshot: (snapshot: PatientVaultSnapshot | null) => void;
} {
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot | null>(null);
  const load = (): void => {
    if (!isPatientVaultUnlocked()) {
      setSnapshot(null);
      return;
    }
    void readPatientVault()
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  };
  onMount(() => {
    void openEncryptedVault()
      .catch(() => onError('Не удалось открыть защищённое хранилище.'))
      .finally(load);
    window.addEventListener(PATIENT_VAULT_EVENT, load);
    onCleanup(() => window.removeEventListener(PATIENT_VAULT_EVENT, load));
  });
  return { snapshot, setSnapshot };
}

export function patientName(snapshot: PatientVaultSnapshot | null, patientId: string): string {
  return snapshot?.profiles.find((profile) => profile.id === patientId)?.displayName ?? '';
}
