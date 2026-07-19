import type {
  ChunkContext,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
} from './documents';
import type { LocalMedError } from './errors';
import type { Result } from './result';
import type { AnalyzeQueryRequest, QueryAnalysis, SearchRequest, SearchResponse } from './search';

export interface CoreStatus {
  readonly state: 'ready';
  readonly schemaVersion: number;
  readonly contentPackIds: readonly string[];
  readonly documentCount: number;
}

export interface CoreCapabilities {
  readonly lexicalSearch: true;
  readonly queryAnalysis: true;
  readonly semanticSearch: boolean;
  readonly embeddingProfileIds: readonly string[];
  readonly cloudChat: false;
  readonly localCaseExtraction: true;
  readonly platform: 'web' | 'android' | 'ios' | 'test' | 'unknown';
  readonly sqliteVersion: string;
  readonly fts5Available: boolean;
  readonly storageBackend: 'in-memory' | 'sqlite-wasm' | 'sqlite-native';
  readonly persistentStorage: boolean;
  readonly storageInstallation: 'memory' | 'copied' | 'reused';
  readonly storageSizeBytes: number | null;
}

export interface AskRequest {
  readonly query: string;
  readonly chunkIds: readonly string[];
}

export interface AskResponse {
  readonly text: string;
}

export interface InstallContentPackRequest {
  readonly source: string;
}

export interface InstallContentPackResponse {
  readonly contentPackId: string;
}

export interface MedicalCore {
  initialize(): Promise<Result<CoreStatus, LocalMedError>>;
  getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>>;
  listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>>;
  analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>>;
  search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>>;
  getDocument(documentId: string): Promise<Result<MedicalDocument, LocalMedError>>;
  getSection(sectionId: string): Promise<Result<MedicalSection, LocalMedError>>;
  getContext(chunkId: string, radius?: number): Promise<Result<ChunkContext, LocalMedError>>;
  ask(request: AskRequest): Promise<Result<AskResponse, LocalMedError>>;
  installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, LocalMedError>>;
  close(): Promise<void>;
}
