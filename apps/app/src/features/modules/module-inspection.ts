import type { DefinitionReferenceReply, DefinitionReferenceRequest } from '@localmed/contracts';
import type { StorageHealth } from '@localmed/storage';
import type { IntegrityScan, SqliteIntegrityReport } from '@localmed/storage-sqlite';

import type { ModuleInspection } from '@/features/modules/module-validation-protocol';

interface InspectableStore {
  initialize(): Promise<StorageHealth>;
  inspectIntegrity(scan?: IntegrityScan): Promise<SqliteIntegrityReport>;
  reference(request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply>;
}

/** The checks of a freshly opened module index; the same on the page and in the worker. */
export async function inspectModuleStore(
  store: InspectableStore,
  scan: IntegrityScan,
  reference: DefinitionReferenceRequest | undefined,
  time: <T>(phase: string, run: () => Promise<T>) => Promise<T> = (_phase, run) => run(),
): Promise<ModuleInspection> {
  const health = await time('validate-initialize', () => store.initialize());
  const integrity = await time('validate-integrity', () => store.inspectIntegrity(scan));
  if (!reference) return { health, integrity };
  return { health, integrity, reference: await store.reference(reference) };
}
