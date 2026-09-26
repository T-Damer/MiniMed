import type { ContentPackSeed, DefinitionReferenceRequest } from '@localmed/contracts';
import type { LexicalSearchRequest, VectorSearchRequest } from '@localmed/storage';

export type OpfsPackWorkerMethod =
  | 'reference'
  | 'initialize'
  | 'getHealth'
  | 'inspectIntegrity'
  | 'listDocumentIdentities'
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
  | {
      readonly id: number;
      readonly type: 'open';
      readonly url: string;
      readonly databaseName: string;
      readonly fetchTimeoutMs: number;
      readonly poolName: string;
      readonly waitForDownloadApproval?: boolean;
    }
  | {
      readonly id: number;
      readonly type: 'call';
      readonly method: OpfsPackWorkerMethod;
      readonly args: readonly unknown[];
    };

export type OpfsPackWorkerResponse =
  | { readonly id: number; readonly event: 'download-required' }
  | {
      readonly id: number;
      readonly event: 'download-progress';
      readonly loaded: number;
      readonly total: number;
    }
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly error: string };

export type OpfsPackWorkerOpenOptions = {
  readonly url: string;
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
