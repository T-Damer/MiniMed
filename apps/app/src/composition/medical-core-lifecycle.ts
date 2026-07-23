import type { CoreStatus, MedicalCore } from '@localmed/contracts';

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
  const core = await factory();
  const initialized = await core.initialize();
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
