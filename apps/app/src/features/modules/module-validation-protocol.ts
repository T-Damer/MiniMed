import type { DefinitionReferenceReply, DefinitionReferenceRequest } from '@localmed/contracts';
import type { StorageHealth } from '@localmed/storage';
import type { IntegrityScan, SqliteIntegrityReport } from '@localmed/storage-sqlite';

/** What the validator asks of a downloaded module index: open it, check it, close it. */
export interface ModuleInspectionRequest {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly scan: IntegrityScan;
  readonly reference?: DefinitionReferenceRequest;
}

export interface ModuleInspection {
  readonly health: StorageHealth;
  readonly integrity: SqliteIntegrityReport;
  readonly reference?: DefinitionReferenceReply;
}

export type ModuleInspectionResponse =
  | { readonly id: number; readonly result: ModuleInspection }
  | { readonly id: number; readonly error: string };
