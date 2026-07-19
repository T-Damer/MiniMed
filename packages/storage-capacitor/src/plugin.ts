import { registerPlugin } from '@capacitor/core';

export type NativeSqlValue = string | number | null;
export type NativeSqlRow = Readonly<Record<string, NativeSqlValue>>;

export interface OpenPackOptions {
  readonly assetPath: string;
  readonly databaseName: string;
  readonly expectedSha256: string;
}

export interface NativeDatabaseHealth {
  readonly schemaVersion: number;
  readonly sqliteVersion: string;
  readonly fts5Available: boolean;
  readonly contentPackIds: readonly string[];
  readonly documentCount: number;
  readonly databasePath: string;
  readonly copied: boolean;
  readonly sizeBytes: number;
}

export interface NativeQueryOptions {
  readonly sql: string;
  readonly argsJson?: string;
}

export interface NativeQueryResult {
  readonly rows: readonly NativeSqlRow[];
}

export interface NativeVectorSearchOptions {
  readonly profileId: string;
  readonly vectorBase64: string;
  readonly vectorNorm: number;
  readonly limit: number;
  readonly documentIds?: readonly string[];
  readonly sectionTypes?: readonly string[];
}

export interface NativeVectorHit {
  readonly chunkId: string;
  readonly score: number;
}

export interface NativeVectorSearchResult {
  readonly hits: readonly NativeVectorHit[];
}

export interface LocalMedDatabasePlugin {
  openPack(options: OpenPackOptions): Promise<NativeDatabaseHealth>;
  query(options: NativeQueryOptions): Promise<NativeQueryResult>;
  searchVectors(options: NativeVectorSearchOptions): Promise<NativeVectorSearchResult>;
  close(): Promise<void>;
}

export const LocalMedDatabase = registerPlugin<LocalMedDatabasePlugin>('LocalMedDatabase');
