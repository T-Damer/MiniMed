import type { ContentPackSeed, EmbeddingProfile, SearchFilters } from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';

export type StorageBackend = 'in-memory' | 'sqlite-wasm' | 'sqlite-native';
export type StorageInstallation = 'memory' | 'copied' | 'reused';

export interface StorageHealth {
  readonly schemaVersion: number;
  readonly sqliteVersion: string;
  readonly fts5Available: boolean;
  readonly contentPackIds: readonly string[];
  readonly documentCount: number;
  readonly backend: StorageBackend;
  readonly persistent: boolean;
  readonly installation: StorageInstallation;
  readonly sizeBytes: number | null;
}

export interface LexicalSearchRequest {
  readonly ftsQuery: string;
  readonly terms: readonly string[];
  readonly filters: SearchFilters;
  readonly limit: number;
}

export interface LexicalHit {
  readonly chunk: ChunkRecord;
  readonly section: SectionRecord;
  readonly document: DocumentRecord;
  readonly rank: number;
}

export interface VectorSearchRequest {
  readonly profileId: string;
  readonly vector: readonly number[];
  readonly norm: number;
  readonly filters: SearchFilters;
  readonly limit: number;
}

export interface VectorHit {
  readonly chunk: ChunkRecord;
  readonly section: SectionRecord;
  readonly document: DocumentRecord;
  readonly score: number;
}

export interface MedicalStore {
  initialize(seed?: ContentPackSeed): Promise<StorageHealth>;
  getHealth(): Promise<StorageHealth>;
  listDocuments(): Promise<readonly DocumentRecord[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null>;
  getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]>;
  getSection(id: string): Promise<SectionRecord | null>;
  getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]>;
  getChunk(id: string): Promise<ChunkRecord | null>;
  getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]>;
  listAliases(): Promise<readonly AliasRecord[]>;
  listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]>;
  search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]>;
  searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]>;
  close(): Promise<void>;
}
