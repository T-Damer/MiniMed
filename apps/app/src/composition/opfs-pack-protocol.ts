import type { ContentPackSeed, DefinitionReferenceRequest } from '@localmed/contracts';
import type { LexicalSearchRequest, VectorSearchRequest } from '@localmed/storage';
import type { EncodedModuleIndex } from '@/features/modules/encoded-index-reader';

export type OpfsPackWorkerMethod =
  | 'reference'
  | 'initialize'
  | 'getHealth'
  | 'inspectIntegrity'
  | 'listDocumentIdentities'
  | 'lookupCoreIdentities'
  | 'listSearchDocuments'
  | 'listNavigationDocuments'
  | 'listDocuments'
  | 'getDocument'
  | 'getDocumentByVersionId'
  | 'getSectionsByDocument'
  | 'getSection'
  | 'getChunksByDocument'
  | 'getChunksBySection'
  | 'getChunk'
  | 'getChunkWindow'
  | 'listAliases'
  | 'listEmbeddingProfiles'
  | 'search'
  | 'searchVector'
  | 'close';

export type OpfsPackWorkerRequest =
  | { readonly id: number; readonly type: 'approve-download' }
  | ({
      readonly id: number;
      readonly type: 'open';
    } & OpfsPackWorkerOpenOptions)
  | {
      readonly id: number;
      readonly type: 'call';
      readonly method: OpfsPackWorkerMethod;
      readonly args: readonly unknown[];
    };

// `lock-wait` means another tab owns the pool; `lock-acquired` starts the open timeout.
export type OpfsPackWorkerLockStatus = 'lock-wait' | 'lock-acquired';

export type OpfsPackWorkerResponse =
  | { readonly id: number; readonly event: 'download-required' }
  | {
      readonly id: number;
      readonly event: 'download-progress';
      readonly loaded: number;
      /** 0 when the size of the streamed bytes is unknown (for example, compressed in transit). */
      readonly total: number;
      /** Present once the download is written and the database is being opened and checked. */
      readonly phase?: 'installing';
    }
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly error: string }
  | { readonly id: number; readonly status: OpfsPackWorkerLockStatus };

/** What an OPFS pack worker opens: fetched, already installed, or decoded from a zstd archive. */
export type OpfsPackWorkerSource =
  | { readonly url: string }
  | { readonly installed: { readonly byteLength: number } }
  | { readonly encoded: EncodedModuleIndex };

export type OpfsPackWorkerOpenOptions = OpfsPackWorkerSource & {
  readonly databaseName: string;
  readonly fetchTimeoutMs: number;
  readonly poolName: string;
  readonly waitForDownloadApproval?: boolean;
};

export type OpfsPackWorkerCallArgs = {
  readonly reference: readonly [request: DefinitionReferenceRequest];
  readonly initialize: readonly [seed?: ContentPackSeed];
  readonly getHealth: readonly [];
  readonly inspectIntegrity: readonly [];
  readonly listDocumentIdentities: readonly [];
  readonly lookupCoreIdentities: readonly [query: string];
  readonly listSearchDocuments: readonly [];
  readonly listNavigationDocuments: readonly [];
  readonly listDocuments: readonly [];
  readonly getDocument: readonly [id: string];
  readonly getDocumentByVersionId: readonly [versionId: string];
  readonly getSectionsByDocument: readonly [documentId: string];
  readonly getSection: readonly [id: string];
  readonly getChunksByDocument: readonly [documentId: string];
  readonly getChunksBySection: readonly [sectionId: string];
  readonly getChunk: readonly [id: string];
  readonly getChunkWindow: readonly [chunkId: string, radius: number];
  readonly listAliases: readonly [];
  readonly listEmbeddingProfiles: readonly [];
  readonly search: readonly [request: LexicalSearchRequest];
  readonly searchVector: readonly [request: VectorSearchRequest];
  readonly close: readonly [];
};
