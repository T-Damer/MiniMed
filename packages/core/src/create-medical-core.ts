import {
  AnalyzeQueryRequestSchema,
  type ChunkContext,
  ContentPackSeedSchema,
  type CoreCapabilities,
  type CoreStatus,
  err,
  type LocalMedError,
  localMedError,
  type MedicalCore,
  type MedicalDocument,
  type MedicalDocumentSummary,
  type MedicalSection,
  ok,
  type QueryAnalysis,
  type Result,
  SearchRequestSchema,
  type SearchResponse,
  type SearchResult,
  type SearchResultCategory,
  type SearchResultGroup,
} from '@localmed/contracts';
import {
  analyzeClinicalQuery,
  buildSnippet,
  type LexicalQueryBranchPlan,
  normalizeSurfaceText,
} from '@localmed/search-lexical';
import { profilesCompatible, type QueryEmbedder } from '@localmed/search-semantic';
import type { LexicalHit, MedicalStore, VectorHit } from '@localmed/storage';

import { toDocumentSummary, toMedicalDocument, toMedicalSection } from './mappers';

export interface CreateMedicalCoreOptions {
  readonly store: MedicalStore;
  readonly seed?: unknown;
  readonly platform?: CoreCapabilities['platform'];
  readonly embedder?: QueryEmbedder;
}

interface AggregatedHit {
  readonly hit: LexicalHit;
  readonly branchIds: Set<string>;
  readonly branchLabels: Set<string>;
  readonly terms: Set<string>;
  readonly branchScores: number[];
  sectionBoost: number;
  score: number;
  bestLexicalScore: number;
}

function asLocalMedError(error: unknown): LocalMedError {
  if (error instanceof Error) {
    const code = error.message.includes('FTS5') ? 'FTS5_UNAVAILABLE' : 'DATABASE_UNAVAILABLE';
    return localMedError(code, error.message, { name: error.name });
  }
  return localMedError('UNKNOWN', 'Unknown LocalMed core error.');
}

function matchedTerms(hit: LexicalHit, terms: readonly string[]): readonly string[] {
  const haystack = normalizeSurfaceText(
    `${hit.document.title} ${hit.section.sectionPath.join(' ')} ${hit.chunk.originalText}`,
  );
  return terms.filter((term) => haystack.includes(normalizeSurfaceText(term)));
}

function resultCategory(sectionType: string | null): SearchResultCategory {
  switch (sectionType) {
    case 'definition':
    case 'classification':
      return 'overview';
    case 'clinical-picture':
      return 'clinical-picture';
    case 'differential-diagnosis':
      return 'differential-diagnosis';
    case 'diagnostics':
      return 'diagnostics';
    case 'treatment':
      return 'treatment';
    case 'routing':
      return 'routing';
    case 'rehabilitation':
    case 'follow-up':
    case 'prevention':
      return 'follow-up';
    default:
      return 'other';
  }
}

function toSearchResult(aggregate: AggregatedHit): SearchResult {
  const terms = [...aggregate.terms];
  const matches = matchedTerms(aggregate.hit, terms);
  const snippet = buildSnippet(
    aggregate.hit.chunk.originalText,
    matches.length > 0 ? matches : terms,
  );
  return {
    chunkId: aggregate.hit.chunk.id,
    documentId: aggregate.hit.document.id,
    documentVersionId: aggregate.hit.document.version.id,
    sectionId: aggregate.hit.section.id,
    anchor: aggregate.hit.chunk.anchor,
    title: aggregate.hit.document.title,
    sectionPath: aggregate.hit.section.sectionPath,
    snippet: snippet.text,
    highlightedRanges: snippet.ranges,
    lexicalScore: aggregate.bestLexicalScore,
    semanticScore: null,
    finalScore: aggregate.score,
    matchedTerms: matches,
    matchedBranches: [...aggregate.branchLabels],
    sectionType: aggregate.hit.section.sectionType,
    category: resultCategory(aggregate.hit.section.sectionType),
  };
}

function requestedSectionType(query: string): 'diagnostics' | 'routing' | null {
  if (/(?:^|\s)диагностик/u.test(query)) return 'diagnostics';
  if (/(?:маршрутизац|госпитализац|экстренн|интенсивн[а-я]*\s+помощ)/u.test(query)) {
    return 'routing';
  }
  return null;
}

function groupResults(
  results: readonly SearchResult[],
  preferredSectionType: 'diagnostics' | 'routing' | null,
): readonly SearchResultGroup[] {
  const byDocument = new Map<string, SearchResult[]>();
  for (const result of results) {
    const group = byDocument.get(result.documentId) ?? [];
    group.push(result);
    byDocument.set(result.documentId, group);
  }
  return [...byDocument.entries()]
    .map(([documentId, documentResults]) => {
      const sorted = documentResults.toSorted((left, right) => {
        const preferredDifference = preferredSectionType
          ? Number(right.sectionType === preferredSectionType) -
            Number(left.sectionType === preferredSectionType)
          : 0;
        return preferredDifference || right.finalScore - left.finalScore;
      });
      const first = sorted[0];
      if (!first) throw new Error('Search group cannot be empty.');
      return {
        documentId,
        title: first.title,
        bestScore: Math.max(...documentResults.map((result) => result.finalScore)),
        categories: [...new Set(sorted.map((result) => result.category))],
        results: sorted,
      };
    })
    .toSorted((left, right) => right.bestScore - left.bestScore);
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `search-${Date.now()}-${Math.random()}`;
}

function branchSectionBoost(branch: LexicalQueryBranchPlan, hit: LexicalHit): number {
  const titleTokens = normalizeSurfaceText(hit.document.title).split(' ');
  const titleBoost = branch.terms.some(
    (term) =>
      term.length >= 4 &&
      titleTokens.some((titleToken) => titleToken.startsWith(normalizeSurfaceText(term))),
  )
    ? 0.3
    : 0;
  const sectionType = hit.section.sectionType;
  if (branch.kind === 'investigation' && sectionType === 'diagnostics') return titleBoost + 0.03;
  if (branch.kind === 'medication' && sectionType === 'treatment') return titleBoost + 0.03;
  if (
    branch.kind === 'clinical' &&
    (sectionType === 'clinical-picture' || sectionType === 'differential-diagnosis')
  ) {
    return titleBoost + 0.025;
  }
  return titleBoost;
}

function fuseBranchHits(
  branchHits: readonly {
    readonly branch: LexicalQueryBranchPlan;
    readonly hits: readonly LexicalHit[];
  }[],
  limit: number,
): readonly SearchResult[] {
  const aggregateByChunk = new Map<string, AggregatedHit>();

  for (const { branch, hits } of branchHits) {
    const strongestLexicalScore = Math.max(0.000_001, ...hits.map((hit) => hit.rank));
    for (const [index, hit] of hits.entries()) {
      const existing = aggregateByChunk.get(hit.chunk.id) ?? {
        hit,
        branchIds: new Set<string>(),
        branchLabels: new Set<string>(),
        terms: new Set<string>(),
        branchScores: [],
        sectionBoost: 0,
        score: 0,
        bestLexicalScore: 0,
      };

      // Preserve the magnitude of the lexical evidence inside each branch. A plain RRF sum can
      // over-promote a weak chunk that happens to occur in many nearly identical branches.
      const relativeLexicalScore = Math.max(0, hit.rank) / strongestLexicalScore;
      const rankPositionSignal = 1 / (index + 1);
      const branchScore = branch.weight * (relativeLexicalScore * 0.82 + rankPositionSignal * 0.18);

      existing.branchScores.push(branchScore);
      existing.sectionBoost = Math.max(existing.sectionBoost, branchSectionBoost(branch, hit));
      existing.bestLexicalScore = Math.max(existing.bestLexicalScore, hit.rank);
      existing.branchIds.add(branch.id);
      existing.branchLabels.add(branch.label);
      for (const term of branch.terms) existing.terms.add(term);
      aggregateByChunk.set(hit.chunk.id, existing);
    }
  }

  for (const aggregate of aggregateByChunk.values()) {
    const [strongest = 0, ...supporting] = aggregate.branchScores.toSorted(
      (left, right) => right - left,
    );
    const corroboration = Math.min(
      strongest * 0.28,
      supporting.reduce((sum, score) => sum + Math.min(score, strongest) * 0.1, 0),
    );
    aggregate.score = strongest + corroboration + aggregate.sectionBoost;
  }

  return [...aggregateByChunk.values()]
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(toSearchResult);
}

function vectorResult(
  hit: VectorHit,
  terms: readonly string[],
  semanticScore: number,
): SearchResult {
  const lexicalLikeHit: LexicalHit = { ...hit, rank: 0 };
  const matches = matchedTerms(lexicalLikeHit, terms);
  const snippet = buildSnippet(hit.chunk.originalText, matches.length > 0 ? matches : terms);
  return {
    chunkId: hit.chunk.id,
    documentId: hit.document.id,
    documentVersionId: hit.document.version.id,
    sectionId: hit.section.id,
    anchor: hit.chunk.anchor,
    title: hit.document.title,
    sectionPath: hit.section.sectionPath,
    snippet: snippet.text,
    highlightedRanges: snippet.ranges,
    lexicalScore: 0,
    semanticScore,
    finalScore: semanticScore,
    matchedTerms: matches,
    matchedBranches: ['Смысловое совпадение'],
    sectionType: hit.section.sectionType,
    category: resultCategory(hit.section.sectionType),
  };
}

function fuseSemanticResults(
  lexicalResults: readonly SearchResult[],
  vectorHits: readonly VectorHit[],
  terms: readonly string[],
  mode: 'semantic' | 'hybrid',
  limit: number,
): readonly SearchResult[] {
  const maximumLexical = Math.max(0.000_001, ...lexicalResults.map((result) => result.finalScore));
  const byChunk = new Map<string, SearchResult>();

  if (mode === 'hybrid') {
    for (const result of lexicalResults) {
      byChunk.set(result.chunkId, {
        ...result,
        finalScore: (result.finalScore / maximumLexical) * 0.78,
      });
    }
  }

  for (const hit of vectorHits) {
    const semanticScore = Math.max(0, hit.score);
    const existing = byChunk.get(hit.chunk.id);
    if (!existing) {
      const result = vectorResult(hit, terms, semanticScore);
      byChunk.set(hit.chunk.id, {
        ...result,
        finalScore: mode === 'semantic' ? semanticScore : semanticScore * 0.62,
      });
      continue;
    }
    const corroboration = semanticScore > 0 ? 0.04 : 0;
    byChunk.set(hit.chunk.id, {
      ...existing,
      semanticScore,
      finalScore: existing.finalScore + semanticScore * 0.22 + corroboration,
      matchedBranches: [...existing.matchedBranches, 'Смысловое совпадение'],
    });
  }

  return [...byChunk.values()]
    .toSorted((left, right) => right.finalScore - left.finalScore)
    .slice(0, limit);
}

function semanticQueryText(analysis: QueryAnalysis): string {
  const positiveFacts = analysis.facts
    .filter((fact) => fact.polarity !== 'negative')
    .map((fact) => fact.normalizedValue)
    .filter((value, index, values) => values.indexOf(value) === index);
  if (positiveFacts.length > 0) return positiveFacts.join(' ');
  const clinicalBranch = analysis.branches.find((branch) => branch.kind === 'clinical');
  return clinicalBranch?.normalizedQuery ?? analysis.normalizedQuery;
}

export function createMedicalCore(options: CreateMedicalCoreOptions): MedicalCore {
  const platform = options.platform ?? 'unknown';
  const seed = options.seed === undefined ? undefined : ContentPackSeedSchema.parse(options.seed);
  let initialized = false;

  const initialize = async (): Promise<Result<CoreStatus, LocalMedError>> => {
    try {
      const health = await options.store.initialize(seed);
      initialized = true;
      return ok({
        state: 'ready',
        schemaVersion: health.schemaVersion,
        contentPackIds: health.contentPackIds,
        documentCount: health.documentCount,
      });
    } catch (error) {
      return err(asLocalMedError(error));
    }
  };

  const ensureInitialized = async (): Promise<Result<CoreStatus, LocalMedError>> => {
    if (initialized) {
      try {
        const health = await options.store.getHealth();
        return ok({
          state: 'ready',
          schemaVersion: health.schemaVersion,
          contentPackIds: health.contentPackIds,
          documentCount: health.documentCount,
        });
      } catch (error) {
        return err(asLocalMedError(error));
      }
    }
    return initialize();
  };

  const getAliases = async (): Promise<
    Result<Awaited<ReturnType<MedicalStore['listAliases']>>, LocalMedError>
  > => {
    const ready = await ensureInitialized();
    if (!ready.ok) return err(ready.error);
    try {
      return ok(await options.store.listAliases());
    } catch (error) {
      return err(asLocalMedError(error));
    }
  };

  const analyze = async (
    query: string,
    includeSuggestions: boolean,
  ): Promise<Result<QueryAnalysis, LocalMedError>> => {
    const aliases = await getAliases();
    if (!aliases.ok) return err(aliases.error);
    return ok(analyzeClinicalQuery(query, aliases.value, includeSuggestions).analysis);
  };

  const getSection = async (sectionId: string): Promise<Result<MedicalSection, LocalMedError>> => {
    try {
      const ready = await ensureInitialized();
      if (!ready.ok) return err(ready.error);
      const section = await options.store.getSection(sectionId);
      if (!section) {
        return err(localMedError('CONTENT_NOT_FOUND', `Section not found: ${sectionId}`));
      }
      const chunks = await options.store.getChunksBySection(sectionId);
      return ok(toMedicalSection(section, chunks));
    } catch (error) {
      return err(asLocalMedError(error));
    }
  };

  return {
    initialize,

    async getCapabilities() {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const health = await options.store.getHealth();
        const embeddingProfiles = await options.store.listEmbeddingProfiles();
        const semanticSearch = Boolean(
          options.embedder &&
            embeddingProfiles.some((profile) =>
              profilesCompatible(profile, options.embedder?.profile ?? profile),
            ),
        );
        return ok({
          lexicalSearch: true,
          queryAnalysis: true,
          semanticSearch,
          embeddingProfileIds: embeddingProfiles.map((profile) => profile.id),
          cloudChat: false,
          localCaseExtraction: true,
          platform,
          sqliteVersion: health.sqliteVersion,
          fts5Available: health.fts5Available,
          storageBackend: health.backend,
          persistentStorage: health.persistent,
          storageInstallation: health.installation,
          storageSizeBytes: health.sizeBytes,
        });
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>> {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const documents = await options.store.listDocuments();
        return ok(documents.map(toDocumentSummary));
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async analyzeQuery(untrustedRequest): Promise<Result<QueryAnalysis, LocalMedError>> {
      const parsed = AnalyzeQueryRequestSchema.safeParse(untrustedRequest);
      if (!parsed.success) {
        return err(
          localMedError('INVALID_REQUEST', 'Query-analysis request is invalid.', {
            issues: parsed.error.issues,
          }),
        );
      }
      return analyze(parsed.data.query, parsed.data.includeSuggestions);
    },

    async search(untrustedRequest): Promise<Result<SearchResponse, LocalMedError>> {
      const startedAt = performance.now();
      const parsed = SearchRequestSchema.safeParse(untrustedRequest);
      if (!parsed.success) {
        return err(
          localMedError('INVALID_REQUEST', 'Search request is invalid.', {
            issues: parsed.error.issues,
          }),
        );
      }

      try {
        const aliasesResult = await getAliases();
        if (!aliasesResult.ok) return err(aliasesResult.error);
        const plan = analyzeClinicalQuery(
          parsed.data.query,
          aliasesResult.value,
          parsed.data.includeSuggestions,
        );
        if (plan.branches.length === 0) {
          return err(localMedError('INVALID_REQUEST', 'Search query has no searchable terms.'));
        }

        const branchHits: {
          branch: LexicalQueryBranchPlan;
          hits: readonly LexicalHit[];
        }[] = [];
        const branchDiagnostics: SearchResponse['diagnostics']['branches'][number][] = [];
        const perBranchLimit = Math.max(parsed.data.limit * 5, 50);

        for (const branch of plan.branches) {
          const branchStartedAt = performance.now();
          const hits = await options.store.search({
            ftsQuery: branch.ftsQuery,
            terms: branch.terms,
            filters: parsed.data.filters,
            limit: perBranchLimit,
          });
          branchHits.push({ branch, hits });
          branchDiagnostics.push({
            id: branch.id,
            label: branch.label,
            ftsQuery: branch.ftsQuery,
            candidateCount: hits.length,
            elapsedMs: performance.now() - branchStartedAt,
            weight: branch.weight,
          });
        }

        const lexicalResults = fuseBranchHits(branchHits, perBranchLimit);
        const requestedMode = parsed.data.mode;
        let modeUsed: SearchResponse['modeUsed'] = 'lexical';
        let vectorHits: readonly VectorHit[] = [];
        let semanticStatus: SearchResponse['diagnostics']['semantic']['status'] =
          requestedMode === 'lexical' ? 'disabled' : 'fallback';
        let semanticProfileId: string | null = null;
        let semanticElapsedMs = 0;
        let semanticFallbackReason: string | null =
          requestedMode === 'lexical' ? null : 'query-embedder-unavailable';

        if (requestedMode !== 'lexical' && options.embedder) {
          const semanticStartedAt = performance.now();
          try {
            const profiles = await options.store.listEmbeddingProfiles();
            const compatibleProfile = profiles.find((profile) =>
              profilesCompatible(profile, options.embedder?.profile ?? profile),
            );
            if (!compatibleProfile) {
              semanticFallbackReason = 'embedding-profile-mismatch';
            } else {
              semanticProfileId = compatibleProfile.id;
              const queryVector = await options.embedder.embedQuery(
                semanticQueryText(plan.analysis),
              );
              if (
                queryVector.profileId !== compatibleProfile.id ||
                queryVector.values.length !== compatibleProfile.dimensions
              ) {
                semanticFallbackReason = 'invalid-query-vector';
              } else {
                vectorHits = await options.store.searchVector({
                  profileId: compatibleProfile.id,
                  vector: queryVector.values,
                  norm: queryVector.norm,
                  filters: parsed.data.filters,
                  limit: Math.max(parsed.data.limit * 5, 50),
                });
                if (vectorHits.length === 0) {
                  semanticFallbackReason = 'no-vector-candidates';
                } else {
                  semanticStatus = 'used';
                  semanticFallbackReason = null;
                  modeUsed = requestedMode === 'semantic' ? 'semantic' : 'hybrid';
                }
              }
            }
          } catch (error) {
            semanticFallbackReason =
              error instanceof Error ? `semantic-error:${error.message}` : 'semantic-error';
          } finally {
            semanticElapsedMs = performance.now() - semanticStartedAt;
          }
        }

        const results =
          modeUsed === 'lexical'
            ? lexicalResults.slice(0, parsed.data.limit)
            : fuseSemanticResults(
                lexicalResults,
                vectorHits,
                plan.terms,
                modeUsed,
                parsed.data.limit,
              );
        const candidateIds = new Set([
          ...branchHits.flatMap((item) => item.hits.map((hit) => hit.chunk.id)),
          ...vectorHits.map((hit) => hit.chunk.id),
        ]);
        return ok({
          requestId: requestId(),
          normalizedQuery: plan.analysis.normalizedQuery,
          elapsedMs: performance.now() - startedAt,
          modeUsed,
          analysis: plan.analysis,
          suggestions: plan.analysis.suggestions,
          groups: groupResults(results, requestedSectionType(plan.analysis.normalizedQuery)),
          diagnostics: {
            ftsQuery: plan.branches.map((branch) => branch.ftsQuery).join(' || '),
            candidateCount: candidateIds.size,
            aliasMatches: plan.aliasMatches,
            terms: plan.terms,
            branches: branchDiagnostics,
            semantic: {
              status: semanticStatus,
              requestedMode,
              profileId: semanticProfileId,
              candidateCount: vectorHits.length,
              elapsedMs: semanticElapsedMs,
              fallbackReason: semanticFallbackReason,
            },
          },
        });
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async getDocument(documentId): Promise<Result<MedicalDocument, LocalMedError>> {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const document = await options.store.getDocument(documentId);
        if (!document) {
          return err(localMedError('CONTENT_NOT_FOUND', `Document not found: ${documentId}`));
        }
        const sectionRecords = await options.store.getSectionsByDocument(documentId);
        const sections = await Promise.all(
          sectionRecords.map(async (section) =>
            toMedicalSection(section, await options.store.getChunksBySection(section.id)),
          ),
        );
        return ok(toMedicalDocument(document, sections));
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    getSection,

    async getContext(chunkId, radius = 1): Promise<Result<ChunkContext, LocalMedError>> {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const chunk = await options.store.getChunk(chunkId);
        if (!chunk) return err(localMedError('CONTENT_NOT_FOUND', `Chunk not found: ${chunkId}`));
        const section = await options.store.getSection(chunk.sectionId);
        const document = await options.store.getDocumentByVersionId(chunk.documentVersionId);
        if (!section || !document) {
          return err(
            localMedError('CONTENT_NOT_FOUND', `Context is incomplete for chunk: ${chunkId}`),
          );
        }
        const window = await options.store.getChunkWindow(
          chunkId,
          Math.max(0, Math.min(radius, 8)),
        );
        return ok({
          document: toDocumentSummary(document),
          section: toMedicalSection(section, await options.store.getChunksBySection(section.id)),
          focusChunkId: chunkId,
          chunks: window.map((item) => ({
            id: item.id,
            sectionId: item.sectionId,
            documentVersionId: item.documentVersionId,
            orderIndex: item.orderIndex,
            originalText: item.originalText,
            pageStart: item.pageStart,
            pageEnd: item.pageEnd,
            anchor: item.anchor,
          })),
          previousChunkId: chunk.previousChunkId,
          nextChunkId: chunk.nextChunkId,
        });
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async ask() {
      return err(
        localMedError(
          'FEATURE_DISABLED',
          'Generative answers are intentionally disabled in LocalMed 0.3.0-alpha.1.',
        ),
      );
    },

    async installContentPack() {
      return err(
        localMedError(
          'FEATURE_DISABLED',
          'Dynamic content-pack installation is planned after the 0.3.0 retrieval milestone.',
        ),
      );
    },

    async close(): Promise<void> {
      await options.store.close();
      initialized = false;
    },
  };
}
