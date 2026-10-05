import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

import { clearFormSessions } from '@/features/forms/form-session';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  acknowledgePatientVaultUiCleared,
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

export interface PatientVaultSnapshotState {
  readonly snapshot: Accessor<PatientVaultSnapshot | undefined>;
  readonly unlocked: Accessor<boolean>;
  /** Hands over the snapshot the unlock dialog just opened. */
  readonly adopt: (snapshot: PatientVaultSnapshot) => void;
}

/**
 * Follows the patient vault without opening it: while it is locked there is no snapshot, and the
 * moment it locks again the snapshot and any typed form values are dropped.
 */
export function usePatientVaultSnapshot(): PatientVaultSnapshotState {
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot>();
  let request = 0;
  const refresh = (): void => {
    const current = ++request;
    if (!isPatientVaultUnlocked()) {
      setSnapshot(undefined);
      clearFormSessions();
      acknowledgePatientVaultUiCleared();
      return;
    }
    void readPatientVault()
      .then((next) => {
        if (current === request && isPatientVaultUnlocked()) setSnapshot(next);
      })
      .catch(() => {
        if (current === request) setSnapshot(undefined);
      });
  };
  onMount(() => {
    window.addEventListener(PATIENT_VAULT_EVENT, refresh);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refresh);
    onCleanup(() => {
      window.removeEventListener(PATIENT_VAULT_EVENT, refresh);
      window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refresh);
    });
    refresh();
  });
  return {
    snapshot,
    unlocked: () => snapshot() !== undefined && isPatientVaultUnlocked(),
    adopt: (next) => {
      request += 1;
      setSnapshot(next);
    },
  };
}
