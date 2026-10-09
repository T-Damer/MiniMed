import type { CoreStatus, MedicalCore } from '@localmed/contracts';

import { RetirableMedicalCore } from '@/composition/retirable-medical-core';
import { timeInstallPhase } from '@/features/modules/install-timing';

export interface InitializedMedicalCore {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
}

async function closeQuietly(core: MedicalCore): Promise<void> {
  try {
    await core.close();
  } catch (cause) {
    console.warn('Unable to close the previous MedicalCore instance.', cause);
  }
}

export async function initializeMedicalCore(
  factory: () => Promise<MedicalCore>,
): Promise<InitializedMedicalCore> {
  const core = await timeInstallPhase('core-create', factory);
  const initialized = await timeInstallPhase('core-initialize', () => core.initialize());
  if (!initialized.ok) {
    await closeQuietly(core);
    throw new Error(initialized.error.message);
  }
  return { core, status: initialized.value };
}

export async function replaceMedicalCore(
  current: InitializedMedicalCore,
  factory: () => Promise<MedicalCore>,
): Promise<InitializedMedicalCore> {
  const next = await initializeMedicalCore(factory);
  await closeQuietly(current.core);
  return next;
}

/**
 * Replaces the active core without a window in which callers can reach a closed one: the previous
 * core forwards new calls to its successor and closes only after its running calls have settled,
 * and `onSwapped` publishes the successor (state, search core) before that close starts.
 */
export async function swapMedicalCore(
  current: InitializedMedicalCore,
  factory: () => Promise<MedicalCore>,
  onSwapped: (next: InitializedMedicalCore) => void,
): Promise<InitializedMedicalCore> {
  const next = await initializeMedicalCore(factory);
  if (current.core instanceof RetirableMedicalCore) current.core.handOverTo(next.core);
  onSwapped(next);
  await closeQuietly(current.core);
  return next;
}
