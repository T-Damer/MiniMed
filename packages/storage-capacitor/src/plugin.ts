import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

export type NativeSqlValue = string | number | null;
export type NativeSqlRow = Readonly<Record<string, NativeSqlValue>>;

export interface OpenPackOptions {
  readonly assetPath: string;
  readonly databaseName: string;
  readonly expectedSha256: string;
}

export interface NativeDatabaseHealth {
  readonly openTimings?: {
    readonly capabilitiesMs: number;
    readonly installedFileMs: number;
    readonly sqliteOpenMs: number;
    readonly integrityMs: number;
    readonly integrityCached: boolean;
    readonly metadataMs: number;
    readonly totalMs: number;
  };
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
  readonly specialties?: readonly string[];
  readonly ageGroups?: readonly string[];
  readonly sectionTypes?: readonly string[];
}

export interface NativeVectorHit {
  readonly chunkId: string;
  readonly score: number;
}

export interface NativeVectorSearchResult {
  readonly hits: readonly NativeVectorHit[];
}

export interface NativeCoreDownloadPlugin {
  hasCorePack(options: {
    readonly expectedSha256: string;
  }): Promise<{ readonly installed: boolean; readonly databasePath?: string }>;
  prepareNativeDownload(options: {
    readonly id: string;
  }): Promise<{ readonly destination: string; readonly filePath: string }>;
  inspectNativeDownload(options: {
    readonly id: string;
  }): Promise<{ readonly filePath: string; readonly sizeBytes: number }>;
  /**
   * `expectedSha256` identifies the installed SQLite file. With `compression: 'gzip'` the
   * downloaded transfer is inflated while it streams and the decoded bytes are what is verified.
   */
  installDownloadedCore(options: {
    readonly id: string;
    readonly expectedSha256: string;
    readonly compression?: 'gzip';
  }): Promise<void>;
  addListener(
    event: 'coreDownloadProgress',
    listener: (progress: {
      readonly loaded: number;
      readonly total: number;
      readonly phase?: 'downloading' | 'verifying' | 'installing';
    }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface LocalMedDatabasePlugin {
  openPack(options: OpenPackOptions): Promise<NativeDatabaseHealth>;
  query(options: NativeQueryOptions): Promise<NativeQueryResult>;
  searchVectors(options: NativeVectorSearchOptions): Promise<NativeVectorSearchResult>;
  close(): Promise<void>;
}

export const LocalMedDatabase = registerPlugin<LocalMedDatabasePlugin & NativeCoreDownloadPlugin>(
  'LocalMedDatabase',
);
