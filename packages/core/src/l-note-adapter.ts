import {
  type AnalyzeQueryRequest,
  type AskRequest,
  type AskResponse,
  type ChunkContext,
  type CoreCapabilities,
  type CoreStatus,
  err,
  type InstallContentPackRequest,
  type InstallContentPackResponse,
  type LocalMedError,
  localMedError,
  type MedicalChunk,
  type MedicalCore,
  type MedicalDocument,
  type MedicalDocumentSummary,
  type MedicalSection,
  ok,
  type QueryAnalysis,
  type Result,
  type SearchFilters,
  type SearchMode,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  type SearchResultCategory,
} from '@localmed/contracts';

export interface LNoteReadyState {
  readonly schemaVersion: number;
  readonly packIds: readonly string[];
  readonly documentCount: number;
}

export interface LNoteCapabilities {
  readonly semanticSearch: boolean;
  readonly embeddingProfileIds?: readonly string[];
  readonly sqliteVersion?: string;
  readonly fts5Available?: boolean;
  readonly persistentStorage?: boolean;
  readonly storageInstallation?: CoreCapabilities['storageInstallation'];
  readonly storageSizeBytes?: number | null;
}

export interface LNoteDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly shortTitle?: string | null;
  readonly sourceType?: string;
  readonly status?: string;
  readonly specialties?: readonly string[];
  readonly versionId: string;
  readonly versionLabel: string;
  readonly effectiveFrom?: string | null;
}

export interface LNoteChunk {
  readonly id: string;
  readonly sectionId: string;
  readonly documentVersionId: string;
  readonly orderIndex: number;
  readonly text: string;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly anchor: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LNoteSection {
  readonly id: string;
  readonly documentVersionId: string;
  readonly parentSectionId?: string | null;
  readonly title: string;
  readonly sectionType?: string | null;
  readonly depth: number;
  readonly orderIndex: number;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly anchor: string;
  readonly path?: readonly string[];
  readonly chunks: readonly LNoteChunk[];
}

export interface LNoteDocument extends LNoteDocumentSummary {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly sections: readonly LNoteSection[];
}

export interface LNoteChunkContext {
  readonly document: LNoteDocumentSummary;
  readonly section: LNoteSection;
  readonly focusChunkId: string;
  readonly chunks: readonly LNoteChunk[];
  readonly previousChunkId?: string | null;
  readonly nextChunkId?: string | null;
}

export interface LNoteQueryAnalysis {
  readonly normalizedQuery: string;
  readonly terms?: readonly string[];
  readonly warnings?: readonly string[];
}

export interface LNoteSearchHit {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sectionId: string;
  readonly anchor: string;
  readonly title: string;
  readonly sectionPath?: readonly string[];
  readonly snippet: string;
  readonly score: number;
  readonly lexicalScore?: number;
  readonly semanticScore?: number | null;
  readonly matchedTerms?: readonly string[];
  readonly sectionType?: string | null;
  readonly category?: SearchResultCategory;
}

export interface LNoteSearchDiagnostics {
  readonly lexicalQuery?: string;
  readonly candidateCount?: number;
  readonly elapsedMs?: number;
  readonly embeddingProfileId?: string | null;
  readonly semanticFallbackReason?: string | null;
}

export interface LNoteSearchResponse {
  readonly requestId: string;
  readonly normalizedQuery: string;
  readonly elapsedMs: number;
  readonly modeUsed: Exclude<SearchMode, 'auto'>;
  readonly hits: readonly LNoteSearchHit[];
  readonly analysis?: LNoteQueryAnalysis;
  readonly diagnostics?: LNoteSearchDiagnostics;
}

export interface LNoteSearchRequest {
  readonly query: string;
  readonly mode: SearchMode;
  readonly filters: SearchFilters;
  readonly limit: number;
}

export type LNoteErrorCode = 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_REQUEST' | 'UNKNOWN';

export interface LNoteClientError extends Error {
  readonly code?: LNoteErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface LNoteClient {
  initialize(): Promise<LNoteReadyState>;
  getCapabilities(): Promise<LNoteCapabilities>;
  listDocuments(): Promise<readonly LNoteDocumentSummary[]>;
  analyzeQuery?(request: AnalyzeQueryRequest): Promise<LNoteQueryAnalysis>;
  search(request: LNoteSearchRequest): Promise<LNoteSearchResponse>;
  getDocument(documentId: string): Promise<LNoteDocument>;
  getSection(sectionId: string): Promise<LNoteSection>;
  getContext(chunkId: string, radius: number): Promise<LNoteChunkContext>;
  ask?(request: AskRequest): Promise<AskResponse>;
  installContentPack?(request: InstallContentPackRequest): Promise<InstallContentPackResponse>;
  close(): Promise<void>;
}

export interface LNoteMedicalCoreAdapterOptions {
  readonly platform?: CoreCapabilities['platform'];
  readonly storageBackend?: CoreCapabilities['storageBackend'];
  readonly normalizeScore?: (score: number) => number;
}

function defaultNormalizeScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score <= 1) return score;
  return score / (score + 1);
}

function normalizeTerms(query: string): readonly string[] {
  return [...new Set(query.toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function toQueryAnalysis(query: string, value?: LNoteQueryAnalysis): QueryAnalysis {
  const normalizedQuery = value?.normalizedQuery.trim() || query.trim().toLocaleLowerCase('ru-RU');
  const terms = value?.terms ?? normalizeTerms(normalizedQuery);
  return {
    originalQuery: query,
    normalizedQuery,
    intent: {
      primary: 'unknown',
      secondary: [],
      confidence: 0,
      matchedSignals: [],
      needsClarification: false,
    },
    facts: [],
    branches: [
      {
        id: 'l-note:original',
        kind: 'original',
        label: 'L-Note',
        query,
        normalizedQuery,
        terms,
        weight: 1,
      },
    ],
    suggestions: [],
    warnings: value?.warnings ?? [],
  };
}

function toDocumentSummary(value: LNoteDocumentSummary): MedicalDocumentSummary {
  return {
    id: value.id,
    title: value.title,
    shortTitle: value.shortTitle ?? null,
    sourceType: value.sourceType ?? 'l-note-document',
    status: value.status ?? 'active',
    specialties: value.specialties ?? [],
    versionId: value.versionId,
    versionLabel: value.versionLabel,
    effectiveFrom: value.effectiveFrom ?? null,
  };
}

function toChunk(value: LNoteChunk): MedicalChunk {
  return {
    id: value.id,
    sectionId: value.sectionId,
    documentVersionId: value.documentVersionId,
    orderIndex: value.orderIndex,
    originalText: value.text,
    pageStart: value.pageStart ?? null,
    pageEnd: value.pageEnd ?? null,
    anchor: value.anchor,
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

function toSection(value: LNoteSection): MedicalSection {
  return {
    id: value.id,
    documentVersionId: value.documentVersionId,
    parentSectionId: value.parentSectionId ?? null,
    title: value.title,
    sectionType: value.sectionType ?? null,
    depth: value.depth,
    orderIndex: value.orderIndex,
    pageStart: value.pageStart ?? null,
    pageEnd: value.pageEnd ?? null,
    anchor: value.anchor,
    sectionPath: value.path ?? [value.title],
    chunks: value.chunks.map(toChunk),
  };
}

function toDocument(value: LNoteDocument): MedicalDocument {
  return {
    ...toDocumentSummary(value),
    metadata: value.metadata ?? {},
    sections: value.sections.map(toSection),
  };
}

function toContext(value: LNoteChunkContext): ChunkContext {
  return {
    document: toDocumentSummary(value.document),
    section: toSection(value.section),
    focusChunkId: value.focusChunkId,
    chunks: value.chunks.map(toChunk),
    previousChunkId: value.previousChunkId ?? null,
    nextChunkId: value.nextChunkId ?? null,
  };
}

function inferCategory(sectionType: string | null): SearchResultCategory {
  switch (sectionType) {
    case 'overview':
    case 'clinical-picture':
    case 'differential-diagnosis':
    case 'diagnostics':
    case 'treatment':
    case 'routing':
    case 'follow-up':
      return sectionType;
    default:
      return 'other';
  }
}

function mapClientError(cause: unknown, operation: string): LocalMedError {
  const clientError = cause as Partial<LNoteClientError> | null;
  const code =
    clientError?.code === 'NOT_FOUND'
      ? 'CONTENT_NOT_FOUND'
      : clientError?.code === 'UNAVAILABLE'
        ? 'DATABASE_UNAVAILABLE'
        : clientError?.code === 'INVALID_REQUEST'
          ? 'INVALID_REQUEST'
          : 'UNKNOWN';
  const message = cause instanceof Error ? cause.message : `L-Note ${operation} failed.`;
  return localMedError(code, message, {
    ...(clientError?.details ?? {}),
    adapter: 'l-note',
    operation,
  });
}

export class LNoteMedicalCoreAdapter implements MedicalCore {
  readonly #client: LNoteClient;
  readonly #options: LNoteMedicalCoreAdapterOptions;
  readonly #normalizeScore: (score: number) => number;
  #closed = false;

  constructor(client: LNoteClient, options: LNoteMedicalCoreAdapterOptions = {}) {
    this.#client = client;
    this.#options = options;
    this.#normalizeScore = options.normalizeScore ?? defaultNormalizeScore;
  }

  async initialize(): Promise<Result<CoreStatus, LocalMedError>> {
    try {
      const status = await this.#client.initialize();
      this.#closed = false;
      return ok({
        state: 'ready',
        schemaVersion: status.schemaVersion,
        contentPackIds: status.packIds,
        documentCount: status.documentCount,
      });
    } catch (cause) {
      return err(mapClientError(cause, 'initialize'));
    }
  }

  async getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>> {
    try {
      const capabilities = await this.#client.getCapabilities();
      return ok({
        lexicalSearch: true,
        queryAnalysis: true,
        semanticSearch: capabilities.semanticSearch,
        embeddingProfileIds: capabilities.embeddingProfileIds ?? [],
        cloudChat: false,
        localCaseExtraction: false,
        platform: this.#options.platform ?? 'unknown',
        sqliteVersion: capabilities.sqliteVersion ?? 'l-note',
        fts5Available: capabilities.fts5Available ?? false,
        storageBackend: this.#options.storageBackend ?? 'multi-store',
        persistentStorage: capabilities.persistentStorage ?? true,
        storageInstallation: capabilities.storageInstallation ?? 'reused',
        storageSizeBytes: capabilities.storageSizeBytes ?? null,
      });
    } catch (cause) {
      return err(mapClientError(cause, 'getCapabilities'));
    }
  }

  async listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
    try {
      return ok((await this.#client.listDocuments()).map(toDocumentSummary));
    } catch (cause) {
      return err(mapClientError(cause, 'listDocuments'));
    }
  }

  async analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
    try {
      const analysis = this.#client.analyzeQuery
        ? await this.#client.analyzeQuery(request)
        : undefined;
      return ok(toQueryAnalysis(request.query, analysis));
    } catch (cause) {
      return err(mapClientError(cause, 'analyzeQuery'));
    }
  }

  async search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>> {
    try {
      const response = await this.#client.search({
        query: request.query,
        mode: request.mode,
        filters: request.filters,
        limit: request.limit,
      });
      const analysis = toQueryAnalysis(request.query, response.analysis);
      const grouped = new Map<
        string,
        {
          title: string;
          bestScore: number;
          categories: Set<SearchResultCategory>;
          results: SearchResult[];
        }
      >();

      for (const hit of response.hits.slice(0, request.limit)) {
        const sectionType = hit.sectionType ?? null;
        const category = hit.category ?? inferCategory(sectionType);
        const finalScore = this.#normalizeScore(hit.score);
        const result: SearchResult = {
          chunkId: hit.chunkId,
          documentId: hit.documentId,
          documentVersionId: hit.documentVersionId,
          sectionId: hit.sectionId,
          anchor: hit.anchor,
          title: hit.title,
          sectionPath: hit.sectionPath ?? [hit.title],
          snippet: hit.snippet,
          highlightedRanges: [],
          lexicalScore: this.#normalizeScore(hit.lexicalScore ?? hit.score),
          semanticScore:
            hit.semanticScore === null || hit.semanticScore === undefined
              ? null
              : this.#normalizeScore(hit.semanticScore),
          finalScore,
          matchedTerms: hit.matchedTerms ?? [],
          matchedBranches: ['l-note:original'],
          sectionType,
          category,
        };
        const group = grouped.get(hit.documentId) ?? {
          title: hit.title,
          bestScore: 0,
          categories: new Set<SearchResultCategory>(),
          results: [],
        };
        group.bestScore = Math.max(group.bestScore, finalScore);
        group.categories.add(category);
        group.results.push(result);
        grouped.set(hit.documentId, group);
      }

      const groups = [...grouped.entries()]
        .map(([documentId, group]) => ({
          documentId,
          title: group.title,
          bestScore: group.bestScore,
          categories: [...group.categories],
          results: group.results.toSorted((left, right) => right.finalScore - left.finalScore),
        }))
        .sort((left, right) => right.bestScore - left.bestScore);
      const diagnostics = response.diagnostics;
      const terms = response.analysis?.terms ?? normalizeTerms(response.normalizedQuery);
      const semanticStatus =
        response.modeUsed === 'lexical'
          ? ('disabled' as const)
          : diagnostics?.semanticFallbackReason
            ? ('fallback' as const)
            : ('used' as const);

      return ok({
        requestId: response.requestId,
        normalizedQuery: response.normalizedQuery,
        elapsedMs: response.elapsedMs,
        modeUsed: response.modeUsed,
        analysis,
        suggestions: [],
        groups,
        diagnostics: {
          ftsQuery: diagnostics?.lexicalQuery ?? response.normalizedQuery,
          candidateCount: diagnostics?.candidateCount ?? response.hits.length,
          aliasMatches: [],
          terms,
          branches: [
            {
              id: 'l-note:search',
              label: 'L-Note',
              ftsQuery: diagnostics?.lexicalQuery ?? response.normalizedQuery,
              candidateCount: diagnostics?.candidateCount ?? response.hits.length,
              elapsedMs: diagnostics?.elapsedMs ?? response.elapsedMs,
              weight: 1,
            },
          ],
          semantic: {
            status: semanticStatus,
            requestedMode: request.mode,
            profileId: diagnostics?.embeddingProfileId ?? null,
            candidateCount: diagnostics?.candidateCount ?? response.hits.length,
            elapsedMs: diagnostics?.elapsedMs ?? response.elapsedMs,
            fallbackReason: diagnostics?.semanticFallbackReason ?? null,
          },
        },
      });
    } catch (cause) {
      return err(mapClientError(cause, 'search'));
    }
  }

  async getDocument(documentId: string): Promise<Result<MedicalDocument, LocalMedError>> {
    try {
      return ok(toDocument(await this.#client.getDocument(documentId)));
    } catch (cause) {
      return err(mapClientError(cause, 'getDocument'));
    }
  }

  async getSection(sectionId: string): Promise<Result<MedicalSection, LocalMedError>> {
    try {
      return ok(toSection(await this.#client.getSection(sectionId)));
    } catch (cause) {
      return err(mapClientError(cause, 'getSection'));
    }
  }

  async getContext(chunkId: string, radius = 1): Promise<Result<ChunkContext, LocalMedError>> {
    try {
      return ok(toContext(await this.#client.getContext(chunkId, radius)));
    } catch (cause) {
      return err(mapClientError(cause, 'getContext'));
    }
  }

  getSearchResultContext(
    result: Pick<
      SearchResult,
      'chunkId' | 'documentId' | 'sectionId' | 'anchor' | 'title' | 'sectionPath' | 'sectionType'
    >,
    radius = 1,
  ): Promise<Result<ChunkContext, LocalMedError>> {
    return this.getContext(result.chunkId, radius);
  }

  async ask(request: AskRequest): Promise<Result<AskResponse, LocalMedError>> {
    if (!this.#client.ask) {
      return err(localMedError('FEATURE_DISABLED', 'The connected L-Note client has no ask API.'));
    }
    try {
      return ok(await this.#client.ask(request));
    } catch (cause) {
      return err(mapClientError(cause, 'ask'));
    }
  }

  async installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, LocalMedError>> {
    if (!this.#client.installContentPack) {
      return err(
        localMedError('FEATURE_DISABLED', 'The connected L-Note client cannot install packs.'),
      );
    }
    try {
      return ok(await this.#client.installContentPack(request));
    } catch (cause) {
      return err(mapClientError(cause, 'installContentPack'));
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#client.close();
  }
}

export function createLNoteMedicalCoreAdapter(
  client: LNoteClient,
  options: LNoteMedicalCoreAdapterOptions = {},
): MedicalCore {
  return new LNoteMedicalCoreAdapter(client, options);
}
