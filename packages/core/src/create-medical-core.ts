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
  findNormalizedPhraseIndex,
  fuzzyPhraseSpan,
  type LexicalQueryBranchPlan,
  lightStemRussian,
  MIN_FUZZY_TOKEN_LENGTH,
  normalizeSurfaceText,
  searchSubjectText,
  tokenize,
} from '@localmed/search-lexical';
import { profilesCompatible, type QueryEmbedder } from '@localmed/search-semantic';
import type { LexicalHit, MedicalStore, VectorHit } from '@localmed/storage';

import { isSupersededSummaryDocument } from './document-siblings';
import {
  groupChunksBySection,
  toDocumentSummary,
  toMedicalDocument,
  toMedicalSection,
} from './mappers';
import { matchesDocumentAlias, rankSearchGroupsByQuery } from './query-group-ranking';
import {
  resolveSearchResultContext,
  type SearchResultContextHint,
  searchResultContextFallbackMessage,
} from './search-context';

export interface CreateMedicalCoreOptions {
  readonly store: MedicalStore;
  readonly seed?: unknown;
  readonly platform?: CoreCapabilities['platform'];
  readonly embedder?: QueryEmbedder;
  readonly searchExecution?: CoreCapabilities['searchExecution'];
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

const PRESENTATION_FIELD_PATTERN =
  /(?:^|[;\n])\s*(?:-\s*)?(?:тн|торговое\s+наименование|лекарственная\s+форма|нормализованные\s+формы\/дозировки)\s*:\s*([^.;\n]+)/giu;
const KNOWN_PRESENTATION_FIELD_PATTERN =
  /(?:^|[;\n])\s*(?:-\s*)?(?:тн|торговое\s+наименование)\s*:\s*([^.;\n]+)/giu;

function presentationRowTerms(originalText: string, terms: readonly string[]): readonly string[] {
  const normalizedTerms = terms
    .map((term) => normalizeSurfaceText(term))
    .filter((term) => term.length >= 3);
  if (normalizedTerms.length === 0) return [];

  const candidates = originalText
    .split(/\r?\n/u)
    .map((line) => {
      const normalizedLine = normalizeSurfaceText(line);
      const matchedTermCount = new Set(
        normalizedTerms.filter((term) => normalizedLine.includes(term)),
      ).size;
      KNOWN_PRESENTATION_FIELD_PATTERN.lastIndex = 0;
      const exactAliasValues = [...line.matchAll(KNOWN_PRESENTATION_FIELD_PATTERN)].map((match) =>
        normalizeSurfaceText(match[1] ?? ''),
      );
      const exactAliasCount = normalizedTerms.filter((term) =>
        exactAliasValues.includes(term),
      ).length;
      const hasPresentationField = PRESENTATION_FIELD_PATTERN.test(line);
      PRESENTATION_FIELD_PATTERN.lastIndex = 0;
      return { line, matchedTermCount, exactAliasCount, hasPresentationField };
    })
    .filter((candidate) => candidate.hasPresentationField && candidate.matchedTermCount > 0);
  const best = candidates.toSorted(
    (left, right) =>
      right.exactAliasCount - left.exactAliasCount ||
      right.matchedTermCount - left.matchedTermCount,
  )[0];
  if (!best) return [];

  const values: string[] = [];
  PRESENTATION_FIELD_PATTERN.lastIndex = 0;
  for (const match of best.line.matchAll(PRESENTATION_FIELD_PATTERN)) {
    const value = match[1]?.trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function buildQueryAlignedSnippet(
  hit: LexicalHit,
  terms: readonly string[],
): ReturnType<typeof buildSnippet> {
  const rowTerms = presentationRowTerms(hit.chunk.originalText, terms);
  const snippetTerms = [...terms, ...rowTerms.filter((term) => !terms.includes(term))];
  return buildSnippet(hit.chunk.originalText, snippetTerms, rowTerms.length > 0 ? 520 : 360);
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
  const snippet = buildQueryAlignedSnippet(aggregate.hit, matches.length > 0 ? matches : terms);
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

/**
 * The section a question is *about*, judged from how doctors actually phrase it. Symptom words pull
 * lexical scores toward clinical-picture chunks, so without this preference "чем отпаивать" ranked
 * the symptom description above the rehydration guidance. Order matters: routing outranks treatment
 * so that an urgent "куда/когда" question is not read as a drug question.
 */
export function requestedSectionType(
  query: string,
): 'diagnostics' | 'routing' | 'treatment' | null {
  if (
    /(?:^|\s)диагностик/u.test(query) ||
    /(?:какие|нужны\s+ли)\s+(?:обследовани|анализ)/u.test(query) ||
    /подтвердит[ьи]\s+диагноз/u.test(query)
  ) {
    return 'diagnostics';
  }
  if (
    /(?:маршрутизац|госпитализ|экстренн|реанимац|интенсивн[а-я]*\s+(?:помощ|терапи))/u.test(
      query,
    ) ||
    /красн[а-я]*\s+флаг/u.test(query) ||
    /что\s+делать/u.test(query)
  ) {
    return 'routing';
  }
  if (
    /(?:^|\s)(?:лечени|лечить|терапи)/u.test(query) ||
    /(?:^|\s)(?:показани|применени|применять|применяют)/u.test(query) ||
    /(?:отпаива|чем\s+поить)/u.test(query) ||
    /антибиотик/u.test(query) ||
    /препарат[а-я]*\s+выбора/u.test(query) ||
    /дозировк/u.test(query)
  ) {
    return 'treatment';
  }
  return null;
}

/**
 * Sections like "Ограничения"/"Источник и ограничения" describe what a card does NOT cover. They
 * legitimately match many queries (they repeat the card's own terms), but they must not lead a
 * document group unless the doctor asked about limitations themselves.
 */
function isMetaSection(result: SearchResult): boolean {
  const leaf = normalizeSurfaceText(result.sectionPath.at(-1) ?? '');
  return leaf === 'ограничения' || leaf === 'источник и ограничения';
}

interface MedicationAliasCandidate {
  readonly alias: string;
  readonly normalizedAlias: string;
  readonly normalizedCanonicalTerm: string;
}

const TRADE_NAME_FIELD_PATTERN =
  /(?:^|[.;])\s*(?:…\s*)?(?:-\s*)?(?:тн|торговое\s+наименование)\s*:\s*([^.;\n]+)/giu;

function presentationTradeNameFromSnippet(
  snippet: string,
  query: string,
  searchTerms: readonly string[],
  aliases: readonly MedicationAliasCandidate[],
): string | null {
  const normalizedTerms = [
    ...new Set(
      [...searchTerms, ...tokenize(query)]
        .map((term) => normalizeSurfaceText(term))
        .filter((term) => term.length >= 3),
    ),
  ];
  const candidates = snippet.split(/\r?\n/u).flatMap((line) => {
    TRADE_NAME_FIELD_PATTERN.lastIndex = 0;
    return [...line.matchAll(TRADE_NAME_FIELD_PATTERN)].flatMap((match) => {
      const value = match[1]?.trim();
      if (!value) return [];
      const normalizedLine = normalizeSurfaceText(line);
      const normalizedValue = normalizeSurfaceText(value);
      const matchedTermCount = new Set(
        normalizedTerms.filter((term) => normalizedLine.includes(term)),
      ).size;
      const exactQueryAlias = aliases.some((alias) => alias.normalizedAlias === normalizedValue);
      return [{ value, matchedTermCount, exactQueryAlias }];
    });
  });
  return (
    candidates.toSorted(
      (left, right) =>
        right.matchedTermCount - left.matchedTermCount ||
        Number(right.exactQueryAlias) - Number(left.exactQueryAlias),
    )[0]?.value ?? null
  );
}

function selectedGroupPresentation(
  first: SearchResult,
  query: string,
  searchTerms: readonly string[],
  aliases: readonly MedicationAliasCandidate[],
): string | null {
  const normalizedTitle = normalizeSurfaceText(first.title);
  const queryAlias = aliases.find(
    (candidate) => candidate.normalizedCanonicalTerm === normalizedTitle,
  )?.alias;
  const snippetTradeName = presentationTradeNameFromSnippet(
    first.snippet,
    query,
    searchTerms,
    aliases.filter((candidate) => candidate.normalizedCanonicalTerm === normalizedTitle),
  );
  if (!queryAlias || !snippetTradeName) return queryAlias ?? null;
  return tokenize(normalizeSurfaceText(snippetTradeName)).length >
    tokenize(normalizeSurfaceText(queryAlias)).length
    ? snippetTradeName
    : queryAlias;
}

type MedicalAliasRecords = Awaited<ReturnType<MedicalStore['listAliases']>>;
type MedicalAliasRecord = MedicalAliasRecords[number];

function isFixedCombinationTerm(term: string): boolean {
  const normalizedTerm = normalizeSurfaceText(term);
  return /[+;/]/u.test(normalizedTerm) || /(?:^|\s)и(?:\s|$)/u.test(normalizedTerm);
}

function isComponentMedicationAlias(alias: MedicalAliasRecord): boolean {
  if (alias.category !== 'medication') return false;
  const normalizedAlias = normalizeSurfaceText(alias.alias);
  const normalizedCanonicalTerm = normalizeSurfaceText(alias.canonicalTerm);
  return (
    normalizedAlias !== normalizedCanonicalTerm &&
    isFixedCombinationTerm(normalizedCanonicalTerm) &&
    // The light stemmer needs a second pass to align «инфекции» and «инфекций».
    findNormalizedPhraseIndex(
      tokenize(normalizedCanonicalTerm).map(lightStemRussian).map(lightStemRussian).join(' '),
      tokenize(normalizedAlias).map(lightStemRussian).map(lightStemRussian).join(' '),
    ) >= 0
  );
}

function filterQueryAliases(aliases: MedicalAliasRecords): MedicalAliasRecords {
  return aliases.filter(
    (alias) => normalizeSurfaceText(alias.alias).length >= 2 && !isComponentMedicationAlias(alias),
  );
}

function exactMedicationAliasCandidates(
  query: string,
  aliases: MedicalAliasRecords,
): readonly MedicationAliasCandidate[] {
  const normalizedQuery = normalizeSurfaceText(query);
  return aliases
    .filter((alias) => alias.category === 'medication')
    .map((alias) => ({
      alias: alias.alias,
      normalizedAlias: normalizeSurfaceText(alias.alias),
      normalizedCanonicalTerm: normalizeSurfaceText(alias.canonicalTerm),
    }))
    .filter(
      ({ normalizedAlias, normalizedCanonicalTerm }) =>
        normalizedAlias !== normalizedCanonicalTerm &&
        findNormalizedPhraseIndex(normalizedQuery, normalizedAlias) >= 0,
    )
    .toSorted((left, right) => right.normalizedAlias.length - left.normalizedAlias.length);
}

function snippetQueryTokenCoverage(result: SearchResult, searchTerms: readonly string[]): number {
  const snippetTokens = tokenize(result.snippet).filter((token) => token.length >= 4);
  const queryTokens = new Set(
    searchTerms.flatMap((term) => tokenize(term)).filter((token) => token.length >= 4),
  );
  return [...queryTokens].filter((queryToken) =>
    snippetTokens.some(
      (snippetToken) =>
        snippetToken === queryToken ||
        snippetToken.startsWith(queryToken) ||
        queryToken.startsWith(snippetToken),
    ),
  ).length;
}

function presentationAliasSnippetBoost(
  result: SearchResult,
  candidates: readonly MedicationAliasCandidate[],
): number {
  const normalizedSnippet = normalizeSurfaceText(result.snippet);
  const fields = ['тн:', 'торговое наименование:'];
  return candidates.some((candidate) =>
    fields.some(
      (field) =>
        findNormalizedPhraseIndex(normalizedSnippet, `${field} ${candidate.normalizedAlias}.`) >= 0,
    ),
  )
    ? 0.35
    : 0;
}

function suffixFallbackCanonicalTerms(
  query: string,
  aliases: MedicalAliasRecords,
): ReadonlySet<string> {
  const normalizedQuery = normalizeSurfaceText(query);
  const queryTokens = tokenize(normalizedQuery);
  const queryToken = queryTokens.length === 1 ? queryTokens[0] : undefined;
  if (!queryToken || queryToken.length < MIN_FUZZY_TOKEN_LENGTH) return new Set();
  const hasExactSingleTokenMedicationAlias = aliases.some((alias) => {
    if (alias.category !== 'medication') return false;
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    return normalizedAlias === normalizedQuery && tokenize(normalizedAlias).length === 1;
  });
  if (hasExactSingleTokenMedicationAlias) return new Set();

  const canonicalTerms = new Set<string>();
  for (const alias of aliases) {
    if (alias.category !== 'medication') continue;
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const aliasTokens = tokenize(normalizedAlias);
    if (
      aliasTokens.length !== 2 ||
      findNormalizedPhraseIndex(normalizedQuery, normalizedAlias) >= 0 ||
      !fuzzyPhraseSpan(normalizedQuery, normalizedAlias)
    ) {
      continue;
    }
    canonicalTerms.add(normalizeSurfaceText(alias.canonicalTerm));
  }
  return canonicalTerms;
}

function filterSuffixFallbackGroups(
  groups: readonly SearchResultGroup[],
  query: string,
  aliases: MedicalAliasRecords,
): readonly SearchResultGroup[] {
  const canonicalTerms = suffixFallbackCanonicalTerms(query, aliases);
  if (canonicalTerms.size === 0) return groups;

  const canonicalGroups = groups.filter((group) =>
    group.results.some((result) => canonicalTerms.has(normalizeSurfaceText(result.title))),
  );
  return canonicalGroups.length > 0 ? canonicalGroups : groups;
}

function groupResults(
  results: readonly SearchResult[],
  preferredSectionType: 'diagnostics' | 'routing' | 'treatment' | null,
  demoteMetaSections: boolean,
  query: string,
  searchTerms: readonly string[],
  aliases: MedicalAliasRecords,
  documents: readonly Pick<MedicalDocumentSummary, 'id' | 'sourceType' | 'metadata'>[],
  analysis: QueryAnalysis,
): readonly SearchResultGroup[] {
  const medicationAliasCandidates = exactMedicationAliasCandidates(query, aliases);
  const normalizedQuery = normalizeSurfaceText(query);
  const exactPresentationAliasCandidates = medicationAliasCandidates.filter(
    (candidate) => candidate.normalizedAlias === normalizedQuery,
  );
  const byDocument = new Map<string, SearchResult[]>();
  for (const result of results) {
    const group = byDocument.get(result.documentId) ?? [];
    group.push(result);
    byDocument.set(result.documentId, group);
  }
  const groups = [...byDocument.entries()]
    .map(([documentId, documentResults]) => {
      const sorted = documentResults.toSorted((left, right) => {
        const preferredDifference = preferredSectionType
          ? Number(right.sectionType === preferredSectionType) -
            Number(left.sectionType === preferredSectionType)
          : 0;
        const metaDifference = demoteMetaSections
          ? Number(isMetaSection(left)) - Number(isMetaSection(right))
          : 0;
        const presentationAliasDifference =
          presentationAliasSnippetBoost(right, exactPresentationAliasCandidates) -
          presentationAliasSnippetBoost(left, exactPresentationAliasCandidates);
        const snippetCoverageDifference =
          snippetQueryTokenCoverage(right, searchTerms) -
          snippetQueryTokenCoverage(left, searchTerms);
        const originalQueryCoverageDifference =
          snippetQueryTokenCoverage(right, [query]) - snippetQueryTokenCoverage(left, [query]);
        return (
          preferredDifference ||
          metaDifference ||
          presentationAliasDifference ||
          originalQueryCoverageDifference ||
          snippetCoverageDifference ||
          right.finalScore - left.finalScore
        );
      });
      const first = sorted[0];
      if (!first) throw new Error('Search group cannot be empty.');
      const presentation = selectedGroupPresentation(
        first,
        query,
        searchTerms,
        medicationAliasCandidates,
      );
      return {
        documentId,
        title: presentation ? `${presentation} · ${first.title}` : first.title,
        bestScore: Math.max(...documentResults.map((result) => result.finalScore)),
        categories: [...new Set(sorted.map((result) => result.category))],
        results: sorted,
      };
    })
    .toSorted((left, right) => {
      const preferredDifference = preferredSectionType
        ? Number(right.results.some((result) => result.sectionType === preferredSectionType)) -
          Number(left.results.some((result) => result.sectionType === preferredSectionType))
        : 0;
      return preferredDifference || right.bestScore - left.bestScore;
    });
  return rankSearchGroupsByQuery(groups, query, documents, analysis);
}

function filterSupersededSummaryResults(
  results: readonly SearchResult[],
  availableDocumentIds: ReadonlySet<string>,
): readonly SearchResult[] {
  return results.filter(
    (result) => !isSupersededSummaryDocument(result.documentId, availableDocumentIds),
  );
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
  query: string,
  exactAliasDocumentIds: ReadonlySet<string>,
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

  const subject = searchSubjectText(query);
  return [...aggregateByChunk.values()]
    .toSorted((left, right) => right.score - left.score)
    .filter(
      (aggregate, index) =>
        index < limit ||
        exactAliasDocumentIds.has(aggregate.hit.document.id) ||
        normalizeSurfaceText(aggregate.hit.document.title) === subject,
    )
    .map(toSearchResult);
}

function vectorResult(
  hit: VectorHit,
  terms: readonly string[],
  semanticScore: number,
): SearchResult {
  const lexicalLikeHit: LexicalHit = { ...hit, rank: 0 };
  const matches = matchedTerms(lexicalLikeHit, terms);
  const snippet = buildQueryAlignedSnippet(lexicalLikeHit, matches.length > 0 ? matches : terms);
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
  query: string,
  exactAliasDocumentIds: ReadonlySet<string>,
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

  const subject = searchSubjectText(query);
  return [...byChunk.values()]
    .toSorted((left, right) => right.finalScore - left.finalScore)
    .filter(
      (result, index) =>
        index < limit ||
        exactAliasDocumentIds.has(result.documentId) ||
        normalizeSurfaceText(result.title) === subject,
    );
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
  let aliasesPromise: Promise<Result<MedicalAliasRecords, LocalMedError>> | undefined;
  let documentSummariesPromise:
    | Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>>
    | undefined;

  const initialize = async (): Promise<Result<CoreStatus, LocalMedError>> => {
    try {
      aliasesPromise = undefined;
      documentSummariesPromise = undefined;
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
    aliasesPromise ??= (async () => {
      const ready = await ensureInitialized();
      if (!ready.ok) return err(ready.error);
      try {
        return ok(filterQueryAliases(await options.store.listAliases()));
      } catch (error) {
        return err(asLocalMedError(error));
      }
    })();
    const result = await aliasesPromise;
    if (!result.ok) aliasesPromise = undefined;
    return result;
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

  const buildChunkContext = async (
    chunkId: string,
    radius: number,
  ): Promise<ChunkContext | null> => {
    const chunk = await options.store.getChunk(chunkId);
    if (!chunk) return null;
    const section = await options.store.getSection(chunk.sectionId);
    const document = await options.store.getDocumentByVersionId(chunk.documentVersionId);
    if (!section || !document) return null;
    const window = await options.store.getChunkWindow(chunkId, Math.max(0, Math.min(radius, 8)));
    return {
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
    };
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
          ...(options.searchExecution ? { searchExecution: options.searchExecution } : {}),
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
      documentSummariesPromise ??= (async () => {
        try {
          const ready = await ensureInitialized();
          if (!ready.ok) return err(ready.error);
          const documents = await options.store.listDocuments();
          return ok(documents.map(toDocumentSummary));
        } catch (error) {
          return err(asLocalMedError(error));
        }
      })();
      const result = await documentSummariesPromise;
      if (!result.ok) documentSummariesPromise = undefined;
      return result;
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

        const perBranchLimit = Math.max(parsed.data.limit * 5, 50);
        const branchSearches = await Promise.all(
          plan.branches.map(async (branch) => {
            const branchStartedAt = performance.now();
            const hits = await options.store.search({
              ftsQuery: branch.ftsQuery,
              terms: branch.terms,
              filters: parsed.data.filters,
              limit: perBranchLimit,
            });
            return {
              branch,
              hits,
              diagnostics: {
                id: branch.id,
                label: branch.label,
                ftsQuery: branch.ftsQuery,
                candidateCount: hits.length,
                elapsedMs: performance.now() - branchStartedAt,
                weight: branch.weight,
              },
            };
          }),
        );
        const branchHits = branchSearches.map(({ branch, hits }) => ({ branch, hits }));
        const branchDiagnostics = branchSearches.map(({ diagnostics }) => diagnostics);

        const documents = await options.store.listDocuments();
        const exactAliasDocumentIds = new Set(
          documents
            .filter((document) => matchesDocumentAlias(parsed.data.query, document))
            .map((document) => document.id),
        );
        // Keep exact names and every declared meaning through the chunk cutoff for document ranking.
        const lexicalResults = fuseBranchHits(
          branchHits,
          perBranchLimit,
          parsed.data.query,
          exactAliasDocumentIds,
        );
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

        const rankedResults =
          modeUsed === 'lexical'
            ? lexicalResults
            : fuseSemanticResults(
                lexicalResults,
                vectorHits,
                plan.terms,
                modeUsed,
                perBranchLimit,
                parsed.data.query,
                exactAliasDocumentIds,
              );
        const availableDocumentIds = new Set(documents.map((document) => document.id));
        const results = filterSupersededSummaryResults(rankedResults, availableDocumentIds);
        const candidateIds = new Set([
          ...branchHits.flatMap((item) => item.hits.map((hit) => hit.chunk.id)),
          ...vectorHits.map((hit) => hit.chunk.id),
        ]);
        const groupedResults = filterSuffixFallbackGroups(
          groupResults(
            results,
            requestedSectionType(plan.analysis.normalizedQuery),
            !/ограничен/u.test(plan.analysis.normalizedQuery),
            plan.analysis.normalizedQuery,
            plan.terms,
            aliasesResult.value,
            documents,
            plan.analysis,
          ),
          plan.analysis.normalizedQuery,
          aliasesResult.value,
        );
        return ok({
          requestId: requestId(),
          normalizedQuery: plan.analysis.normalizedQuery,
          elapsedMs: performance.now() - startedAt,
          modeUsed,
          analysis: plan.analysis,
          suggestions: plan.analysis.suggestions,
          groups: groupedResults.slice(0, parsed.data.limit),
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
        const chunkRecords = await options.store.getChunksByDocument(documentId);
        const chunksBySection = groupChunksBySection(chunkRecords);
        const sections = sectionRecords.map((section) =>
          toMedicalSection(section, chunksBySection.get(section.id) ?? []),
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
        const context = await buildChunkContext(chunkId, radius);
        if (!context) {
          return err(localMedError('CONTENT_NOT_FOUND', `Chunk not found: ${chunkId}`));
        }
        return ok(context);
      } catch (error) {
        return err(asLocalMedError(error));
      }
    },

    async getSearchResultContext(
      result: SearchResultContextHint,
      radius = 1,
    ): Promise<Result<ChunkContext, LocalMedError>> {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const context = await resolveSearchResultContext(
          options.store,
          result,
          radius,
          async (chunkId, resolvedRadius) => buildChunkContext(chunkId, resolvedRadius),
        );
        if (!context) {
          return err(
            localMedError(
              'CONTENT_NOT_FOUND',
              searchResultContextFallbackMessage(result, {
                code: 'CONTENT_NOT_FOUND',
                message: `Chunk not found: ${result.chunkId}`,
              }),
            ),
          );
        }
        return ok(context);
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
      aliasesPromise = undefined;
      documentSummariesPromise = undefined;
    },
  };
}
