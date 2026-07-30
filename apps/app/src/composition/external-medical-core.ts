import type { MedicalCore } from '@localmed/contracts';

export type ExternalMedicalCoreFactory = () => Promise<MedicalCore | null>;

let registeredFactory: ExternalMedicalCoreFactory | null = null;

export function registerExternalMedicalCoreFactory(factory: ExternalMedicalCoreFactory): () => void {
  if (registeredFactory) {
    throw new Error('An external MedicalCore factory is already registered.');
  }
  registeredFactory = factory;
  return () => {
    if (registeredFactory === factory) registeredFactory = null;
  };
}

export function hasExternalMedicalCoreFactory(): boolean {
  return registeredFactory !== null;
}

export async function createRegisteredExternalMedicalCore(): Promise<MedicalCore | null> {
  return registeredFactory ? registeredFactory() : null;
}
