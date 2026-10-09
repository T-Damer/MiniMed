import {
  AnalyzeQueryRequestSchema,
  type ChunkContext,
  ContentPackSeedSchema,
  type CoreCapabilities,
  type CoreStatus,
  DefinitionReferenceRequestSchema,
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
  type SearchFilters,
  type SearchRequest,
  SearchRequestSchema,
  type SearchResponse,
  type SearchResult,
  type SearchResultCategory,
  type SearchResultGroup,
} from '@localmed/contracts';
import {
  analyzeClinicalQuery,
  buildLookupQueryPlan,
  buildSnippet,
  createAliasExpander,
  DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID,
  findNormalizedPhraseIndex,
  fuzzyPhraseSpan,
  hasWordPrefix,
  isSymptomPhraseQuery,
  type LexicalQueryBranchPlan,
  type LookupTermGroup,
  lightStemRussian,
  MIN_FUZZY_TOKEN_LENGTH,
  normalizeSurfaceText,
  searchSubjectText,
  tokenize,
} from '@localmed/search-lexical';
import {
  LEGACY_SEMANTIC_FUSION,
  profilesCompatible,
  type QueryEmbedder,
  type SemanticFusion,
} from '@localmed/search-semantic';
import type {
  LexicalHit,
  MedicalStore,
  SearchDocumentDescriptor,
  VectorHit,
} from '@localmed/storage';

import { isSupersededSummaryDocument } from './document-siblings';
import {
  DEFAULT_ICD_BRIDGE_TUNING,
  documentIcdCodes,
  type IcdBridgeTuning,
  IcdRecommendationIndex,
  isRecommendationDocument,
  titleCoverage,
} from './icd-bridge';
import {
  groupChunksBySection,
  metadataStrings,
  toDocumentSummary,
  toMedicalDocument,
  toMedicalSection,
} from './mappers';
import {
  isMedicationDescriptor,
  isOverviewResult,
  overviewDocumentIds,
  readOverviewHit,
  withOverviewFirst,
} from './medication-overview';
import { nameVariantCandidates, responseNamesQuery } from './name-variant-fallback';
import { QueryDocumentIndex } from './query-document-index';
import {
  collapseGroupsByTargetDocument,
  dropGroupsWithoutSubject,
  rankSearchGroupsByQuery,
} from './query-group-ranking';
import {
  resolveSearchResultContext,
  type SearchResultContextHint,
  searchResultContextFallbackMessage,
} from './search-context';
import { prioritizeSymptomLevelGroups } from './symptom-phrase-ranking';
import { TerminologySearchIndex } from './terminology-search';

export interface CreateMedicalCoreOptions {
  readonly store: MedicalStore;
  readonly seed?: unknown;
  readonly platform?: CoreCapabilities['platform'];
  readonly embedder?: QueryEmbedder;
  readonly searchExecution?: CoreCapabilities['searchExecution'];
  /** S3 switches, on by default; benchmarks turn one off to measure before/after. */
  readonly icdBridge?: boolean | Partial<IcdBridgeTuning>;
  readonly nameVariants?: boolean;
}

interface BranchContribution {
  readonly branchId: string;
  readonly score: number;
}

interface AggregatedHit {
  readonly hit: LexicalHit;
  readonly branchIds: Set<string>;
  readonly branchLabels: Set<string>;
  readonly terms: Set<string>;
  readonly branchContributions: BranchContribution[];
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

/**
 * Query terms found in the hit's text. `wordStart` (lexical lookup) requires a term to begin a word
 * and a short word to end it («боли» is not in «болиголов»); otherwise any substring counts, as the
 * hybrid ranking was tuned with.
 */
function matchedTerms(
  hit: LexicalHit,
  terms: readonly string[],
  wordStart = false,
): readonly string[] {
  const haystack = normalizeSurfaceText(
    `${hit.document.title} ${hit.section.sectionPath.join(' ')} ${hit.chunk.originalText}`,
  );
  return terms.filter((term) => {
    const normalized = normalizeSurfaceText(term);
    return wordStart ? hasWordPrefix(haystack, normalized) : haystack.includes(normalized);
  });
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

function conceptIdFromMetadata(metadata: Readonly<Record<string, unknown>>): string | undefined {
  const value = metadata['conceptId'];
  return typeof value === 'string' && value.trim() ? value : undefined;
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

function toSearchResult(aggregate: AggregatedHit, wordStart = false): SearchResult {
  const terms = [...aggregate.terms];
  const matches = matchedTerms(aggregate.hit, terms, wordStart);
  const snippet = buildQueryAlignedSnippet(aggregate.hit, matches.length > 0 ? matches : terms);
  const conceptId = conceptIdFromMetadata(aggregate.hit.document.metadata);
  return {
    ...(conceptId ? { conceptId } : {}),
    chunkId: aggregate.hit.chunk.id,
    documentId: aggregate.hit.document.id,
    documentVersionId: aggregate.hit.document.version.id,
    sectionId: aggregate.hit.section.id,
    anchor: aggregate.hit.chunk.anchor,
    title: aggregate.hit.document.metadata['terminology']
      ? (aggregate.hit.document.shortTitle ?? aggregate.hit.document.title)
      : aggregate.hit.document.title,
    terminologyConceptIds: metadataStrings(
      aggregate.hit.chunk.metadata,
      'terminologyConceptIds',
    ).filter((id) => /^mesh\.M\d+$/u.test(id)),
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

// Normalizing every medication alias per query dominated search time; the list is immutable.
const preparedMedicationAliases = new WeakMap<
  MedicalAliasRecords,
  readonly MedicationAliasCandidate[]
>();

function exactMedicationAliasCandidates(
  query: string,
  aliases: MedicalAliasRecords,
): readonly MedicationAliasCandidate[] {
  let prepared = preparedMedicationAliases.get(aliases);
  if (!prepared) {
    prepared = aliases
      .filter((alias) => alias.category === 'medication')
      .map((alias) => ({
        alias: alias.alias,
        normalizedAlias: normalizeSurfaceText(alias.alias),
        normalizedCanonicalTerm: normalizeSurfaceText(alias.canonicalTerm),
      }))
      .filter(
        ({ normalizedAlias, normalizedCanonicalTerm }) =>
          normalizedAlias !== normalizedCanonicalTerm,
      );
    preparedMedicationAliases.set(aliases, prepared);
  }
  const normalizedQuery = normalizeSurfaceText(query);
  return prepared
    .filter(
      ({ normalizedAlias }) => findNormalizedPhraseIndex(normalizedQuery, normalizedAlias) >= 0,
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
  protectedDocumentIds: ReadonlySet<string> = new Set(),
): readonly SearchResultGroup[] {
  const canonicalTerms = suffixFallbackCanonicalTerms(query, aliases);
  if (canonicalTerms.size === 0) return groups;

  const canonicalDocumentIds = new Set(
    groups
      .filter((group) =>
        group.results.some((result) => canonicalTerms.has(normalizeSurfaceText(result.title))),
      )
      .map((group) => group.documentId),
  );
  if (canonicalDocumentIds.size === 0) return groups;
  return groups.filter(
    (group) =>
      canonicalDocumentIds.has(group.documentId) || protectedDocumentIds.has(group.documentId),
  );
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
  lookupTermGroups?: readonly LookupTermGroup[],
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
      const conceptId = first.conceptId;
      const sharedConceptId =
        conceptId && sorted.every((result) => result.conceptId === conceptId)
          ? conceptId
          : undefined;
      return {
        ...(sharedConceptId ? { conceptId: sharedConceptId } : {}),
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
  return rankSearchGroupsByQuery(groups, query, documents, analysis, lookupTermGroups);
}

function filterSupersededSummaryResults(
  results: readonly SearchResult[],
  availableDocumentIds: ReadonlySet<string>,
): readonly SearchResult[] {
  return results.filter(
    (result) => !isSupersededSummaryDocument(result.documentId, availableDocumentIds),
  );
}

function exactIdentityDocumentMatchesFilters(
  document: LexicalHit['document'],
  filters: SearchFilters,
): boolean {
  if (filters.documentIds?.length && !filters.documentIds.includes(document.id)) return false;
  if (
    filters.specialties?.length &&
    !filters.specialties.some((specialty) => document.specialties.includes(specialty))
  ) {
    return false;
  }
  if (filters.ageGroups?.length) {
    const ageGroups = metadataStrings(document.metadata, 'ageGroups');
    if (!filters.ageGroups.some((ageGroup) => ageGroups.includes(ageGroup))) return false;
  }
  return true;
}

/** A dose form, a route or a strength in the query asks for that passage, not for an overview. */
function hasMedicationFormFacts(analysis: QueryAnalysis): boolean {
  const context = analysis.clinicalContext;
  return Boolean(
    context &&
      (context.doseForm.length > 0 || context.route.length > 0 || context.strength.length > 0),
  );
}

/** Groups of the top results that start with their drug's overview line (`medication-overview.ts`). */
const OVERVIEW_GROUP_LIMIT = 5;

async function withMedicationOverviews(input: {
  readonly groups: readonly SearchResultGroup[];
  readonly enabled: boolean;
  /** Documents the typed query names exactly: only a drug named by its name gets an overview. */
  readonly named: ReadonlySet<string>;
  readonly documentIndex: QueryDocumentIndex;
  readonly store: MedicalStore;
  readonly filters: SearchFilters;
  readonly terms: readonly string[];
}): Promise<readonly SearchResultGroup[]> {
  const { groups, documentIndex } = input;
  if (!input.enabled) return groups;
  return Promise.all(
    groups.map(async (group, index) => {
      const document = documentIndex.byId.get(group.documentId);
      const first = group.results[0];
      if (
        index >= OVERVIEW_GROUP_LIMIT ||
        !document ||
        !first ||
        !input.named.has(group.documentId) ||
        !isMedicationDescriptor(document) ||
        isOverviewResult(first)
      ) {
        return group;
      }
      const hit = await readOverviewHit(
        input.store,
        overviewDocumentIds(group.documentId, documentIndex),
        input.filters,
      );
      return hit
        ? withOverviewFirst(
            group,
            toSearchResult({
              hit,
              branchIds: new Set(['drug-overview']),
              branchLabels: new Set(['Кратко о препарате']),
              terms: new Set(input.terms),
              branchContributions: [{ branchId: 'drug-overview', score: 1 }],
              sectionBoost: 0,
              score: first.finalScore,
              bestLexicalScore: first.lexicalScore,
            }),
          )
        : group;
    }),
  );
}

function exactIdentityResult(hit: LexicalHit, terms: readonly string[], spelling: boolean) {
  return toSearchResult({
    hit,
    branchIds: new Set([spelling ? 'medication-spelling-identity' : 'exact-identity']),
    branchLabels: new Set([
      spelling ? 'Возможная опечатка в названии препарата' : 'Точное название',
    ]),
    terms: new Set(terms),
    branchContributions: [
      { branchId: spelling ? 'medication-spelling-identity' : 'exact-identity', score: 1 },
    ],
    sectionBoost: 0,
    score: 1,
    bestLexicalScore: 1,
  });
}

async function buildExactIdentityResults(
  store: MedicalStore,
  documentIds: ReadonlySet<string>,
  filters: SearchFilters,
  terms: readonly string[],
  ftsQueries: readonly string[],
  spelling = false,
): Promise<readonly SearchResult[]> {
  const eligible = [...documentIds].filter(
    (id) => !filters.documentIds?.length || filters.documentIds.includes(id),
  );
  if (eligible.length === 0) return [];
  // A lookup's own FTS expression restricted to the missing identities usually returns a passage
  // for each of them in one storage round trip (through the OPFS worker, one message).
  const found = new Map<string, SearchResult>();
  for (const ftsQuery of ftsQueries) {
    const remaining = eligible.filter((id) => !found.has(id));
    if (remaining.length === 0) break;
    const hits = await store.search({
      ftsQuery,
      terms,
      filters: { ...filters, documentIds: remaining },
      limit: Math.min(500, remaining.length * 8),
      diversifyDocuments: false,
    });
    for (const hit of hits) {
      if (!found.has(hit.document.id)) {
        found.set(hit.document.id, exactIdentityResult(hit, terms, spelling));
      }
    }
  }
  const results = await Promise.all(
    eligible.map(async (documentId): Promise<SearchResult | null> => {
      const direct = found.get(documentId);
      if (direct) return direct;
      // Aliases and short titles need not occur in the indexed text: read the first passage.
      const document = await store.getDocument(documentId);
      if (!document || !exactIdentityDocumentMatchesFilters(document, filters)) return null;

      const sections = await store.getSectionsByDocument(documentId);
      // Outline/parent sections can be empty. Stop at the first readable eligible section;
      // do not hydrate the entire document or cross the caller's section filters.
      for (const section of sections) {
        if (
          filters.sectionTypes?.length &&
          (section.sectionType === null || !filters.sectionTypes.includes(section.sectionType))
        ) {
          continue;
        }
        const chunk = (await store.getChunksBySection(section.id)).find(
          (candidate) => candidate.originalText.trim().length > 0,
        );
        if (!chunk) continue;

        return exactIdentityResult({ chunk, section, document, rank: 1 }, terms, spelling);
      }
      return null;
    }),
  );
  return results.filter((result): result is SearchResult => result !== null);
}

function mergeExactIdentityResults(
  rankedResults: readonly SearchResult[],
  exactResults: readonly SearchResult[],
): readonly SearchResult[] {
  if (exactResults.length === 0) return rankedResults;
  const byChunk = new Map(rankedResults.map((result) => [result.chunkId, result]));
  for (const result of exactResults) {
    if (!byChunk.has(result.chunkId)) byChunk.set(result.chunkId, result);
  }
  return [...byChunk.values()];
}

function exactWords(text: string): readonly string[] {
  return normalizeSurfaceText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** True when one retrieved source passage literally contains every word of the typed subject. */
function hitsContainExactSubject(hits: readonly LexicalHit[], subject: string): boolean {
  const wanted = exactWords(subject);
  if (wanted.length === 0) return false;
  return hits.some((hit) => {
    const words = new Set([
      ...exactWords(hit.document.title),
      ...exactWords(hit.section.title),
      ...exactWords(hit.chunk.originalText),
    ]);
    return wanted.every((word) => words.has(word));
  });
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `search-${Date.now()}-${Math.random()}`;
}

function branchSectionBoost(
  branch: LexicalQueryBranchPlan,
  hit: LexicalHit,
  wordStart: boolean,
): number {
  const title = normalizeSurfaceText(hit.document.title);
  const titleTokens = title.split(' ');
  const titleBoost = branch.terms.some(
    (term) =>
      term.length >= 4 &&
      (wordStart
        ? hasWordPrefix(title, normalizeSurfaceText(term))
        : titleTokens.some((titleToken) => titleToken.startsWith(normalizeSurfaceText(term)))),
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
  wordStart: boolean,
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
        branchContributions: [],
        sectionBoost: 0,
        score: 0,
        bestLexicalScore: 0,
      };

      // Preserve the magnitude of the lexical evidence inside each branch. A plain RRF sum can
      // over-promote a weak chunk that happens to occur in many nearly identical branches.
      const relativeLexicalScore = Math.max(0, hit.rank) / strongestLexicalScore;
      const rankPositionSignal = 1 / (index + 1);
      const branchScore = branch.weight * (relativeLexicalScore * 0.82 + rankPositionSignal * 0.18);

      existing.branchContributions.push({ branchId: branch.id, score: branchScore });
      existing.sectionBoost = Math.max(
        existing.sectionBoost,
        branchSectionBoost(branch, hit, wordStart),
      );
      existing.bestLexicalScore = Math.max(existing.bestLexicalScore, hit.rank);
      existing.branchIds.add(branch.id);
      existing.branchLabels.add(branch.label);
      for (const term of branch.terms) existing.terms.add(term);
      aggregateByChunk.set(hit.chunk.id, existing);
    }
  }

  for (const aggregate of aggregateByChunk.values()) {
    const [strongest, ...supporting] = aggregate.branchContributions.toSorted(
      (left, right) => right.score - left.score,
    );
    const strongestScore = strongest?.score ?? 0;
    // A hit reached only through the diluted diagnosis-alias branch (a synonym shared with several
    // unrelated conditions, see search-lexical's buildLookupQueryPlan) is corroborating noise, not
    // independent confirmation: it must not stack on top of a stronger branch's own match. It still
    // sets its own (already discounted) strength when it is the strongest — or only — branch hit.
    const corroboratingScores = supporting
      .filter((contribution) => contribution.branchId !== DILUTED_DIAGNOSIS_ALIAS_BRANCH_ID)
      .map((contribution) => contribution.score);
    const corroboration = Math.min(
      strongestScore * 0.28,
      corroboratingScores.reduce((sum, score) => sum + Math.min(score, strongestScore) * 0.1, 0),
    );
    aggregate.score = strongestScore + corroboration + aggregate.sectionBoost;
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
    .map((aggregate) => toSearchResult(aggregate, wordStart));
}

function vectorResult(
  hit: VectorHit,
  terms: readonly string[],
  semanticScore: number,
): SearchResult {
  const lexicalLikeHit: LexicalHit = { ...hit, rank: 0 };
  const matches = matchedTerms(lexicalLikeHit, terms);
  const snippet = buildQueryAlignedSnippet(lexicalLikeHit, matches.length > 0 ? matches : terms);
  const conceptId = conceptIdFromMetadata(hit.document.metadata);
  return {
    ...(conceptId ? { conceptId } : {}),
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
  fusion: SemanticFusion,
): readonly SearchResult[] {
  const maximumLexical = Math.max(0.000_001, ...lexicalResults.map((result) => result.finalScore));
  const bestCosine = Math.max(0, ...vectorHits.map((hit) => hit.score));
  const semanticStrength = (cosine: number): number =>
    fusion.band === undefined
      ? Math.max(0, cosine)
      : Math.max(0, Math.min(1, (cosine - (bestCosine - fusion.band)) / fusion.band));
  const byChunk = new Map<string, SearchResult>();

  if (mode === 'hybrid') {
    for (const result of lexicalResults) {
      byChunk.set(result.chunkId, {
        ...result,
        finalScore: (result.finalScore / maximumLexical) * fusion.lexicalWeight,
      });
    }
  }

  for (const hit of vectorHits) {
    const semanticScore = Math.max(0, hit.score);
    const strength = semanticStrength(hit.score);
    const existing = byChunk.get(hit.chunk.id);
    if (!existing) {
      const result = vectorResult(hit, terms, semanticScore);
      byChunk.set(hit.chunk.id, {
        ...result,
        finalScore: mode === 'semantic' ? semanticScore : strength * fusion.vectorOnlyWeight,
      });
      continue;
    }
    const corroboration = strength > 0 ? 0.04 : 0;
    byChunk.set(hit.chunk.id, {
      ...existing,
      semanticScore,
      finalScore: existing.finalScore + strength * fusion.corroborationWeight + corroboration,
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

function icdBridgeTuning(
  option: CreateMedicalCoreOptions['icdBridge'],
  analysisMode: SearchRequest['analysisMode'],
): IcdBridgeTuning | null {
  if (option === false) return null;
  const defaults = DEFAULT_ICD_BRIDGE_TUNING[analysisMode === 'clinical' ? 'clinical' : 'lookup'];
  return option === true || option === undefined ? defaults : { ...defaults, ...option };
}

interface IcdBridgeInput {
  readonly groups: readonly SearchResultGroup[];
  readonly documentIndex: QueryDocumentIndex;
  readonly recommendations: IcdRecommendationIndex;
  readonly tuning: IcdBridgeTuning;
  readonly store: MedicalStore;
  readonly filters: SearchFilters;
  readonly terms: readonly string[];
  readonly ftsQueries: readonly string[];
  readonly query: string;
  /** Groups an exact name, alias or spelling candidate pinned; the bridge never goes before them. */
  readonly pinnedIds: ReadonlySet<string>;
  readonly group: (results: readonly SearchResult[]) => readonly SearchResultGroup[];
}

/**
 * Item 4 (S3): the best-ranked documents that carry МКБ codes (cards, disease articles) lend their
 * codes; recommendations listing those codes join the result list. See `icd-bridge.ts`.
 */
async function bridgeIcdRecommendations(
  input: IcdBridgeInput,
): Promise<readonly SearchResultGroup[]> {
  const { groups, documentIndex, tuning } = input;
  if (tuning.requireCardFirst) {
    const first = groups[0] ? documentIndex.byId.get(groups[0].documentId) : undefined;
    if (!first || isRecommendationDocument(first) || documentIcdCodes(first).length === 0)
      return groups;
  }
  const cards: {
    group: SearchResultGroup;
    codes: readonly string[];
    strong: boolean;
  }[] = [];
  for (const group of groups) {
    const document = documentIndex.byId.get(group.documentId);
    if (!document || isRecommendationDocument(document)) continue;
    const codes = documentIcdCodes(document);
    if (codes.length === 0) continue;
    cards.push({
      group,
      codes,
      strong: titleCoverage(group.title, input.query) >= tuning.strongCoverage,
    });
    if (cards.length >= tuning.cards) break;
  }
  const best = Math.max(0, ...cards.map((card) => card.group.bestScore));
  const present = new Set(
    groups.flatMap((group) => {
      const target = documentIndex.byId.get(group.documentId)?.metadata['targetDocumentId'];
      return typeof target === 'string' ? [group.documentId, target] : [group.documentId];
    }),
  );
  const picked = new Map<string, { strong: boolean; code: string; score: number }>();
  for (const card of cards) {
    if (card.group.bestScore < best * tuning.minCardShare) continue;
    if (!card.strong && tuning.weakKeep < 0) continue;
    let added = 0;
    for (const recommendation of input.recommendations.recommendationsFor(
      card.codes,
      tuning.exactOnly,
    )) {
      if (picked.size >= tuning.total || added >= tuning.perCard) break;
      const target = documentIndex.byId.get(recommendation.documentId)?.metadata[
        'targetDocumentId'
      ];
      if (
        picked.has(recommendation.documentId) ||
        present.has(recommendation.documentId) ||
        (typeof target === 'string' && present.has(target))
      )
        continue;
      picked.set(recommendation.documentId, {
        strong: card.strong,
        code: recommendation.code,
        score: card.group.bestScore * tuning.scoreFactor,
      });
      added += 1;
    }
  }
  if (picked.size === 0) return groups;
  const results = (
    await buildExactIdentityResults(
      input.store,
      new Set(picked.keys()),
      input.filters,
      input.terms,
      input.ftsQueries,
    )
  ).map((result) => {
    const source = picked.get(result.documentId);
    return source
      ? {
          ...result,
          finalScore: source.score,
          matchedBranches: [`Рекомендация по коду МКБ ${source.code}`],
        }
      : result;
  });
  const bridged = input.group(results);
  const strong = bridged.filter((group) => picked.get(group.documentId)?.strong);
  const weak = bridged.filter((group) => !picked.get(group.documentId)?.strong);
  // Behind the pinned exact-name groups and the first `keep` recommendations that words found.
  let pinned = 0;
  while (pinned < groups.length && input.pinnedIds.has(groups[pinned]?.documentId ?? ''))
    pinned += 1;
  const insertionIndex = (keep: number) => {
    // A lookup keeps the card that named the diagnosis in first place.
    let index = Math.max(pinned, tuning.requireCardFirst ? 1 : 0);
    let seen = 0;
    for (const [position, group] of groups.entries()) {
      const document = documentIndex.byId.get(group.documentId);
      if (seen >= keep || !document || !isRecommendationDocument(document)) continue;
      seen += 1;
      index = Math.max(index, position + 1);
    }
    return index;
  };
  const weakAt = insertionIndex(tuning.weakKeep);
  const strongAt = insertionIndex(tuning.strongKeep);
  const rest = [...groups];
  // The later position first, so the earlier index stays valid.
  if (weakAt >= strongAt) {
    rest.splice(weakAt, 0, ...weak);
    rest.splice(strongAt, 0, ...strong);
  } else {
    rest.splice(strongAt, 0, ...strong);
    rest.splice(weakAt, 0, ...weak);
  }
  return rest;
}

export function createMedicalCore(options: CreateMedicalCoreOptions): MedicalCore {
  const platform = options.platform ?? 'unknown';
  const seed = options.seed === undefined ? undefined : ContentPackSeedSchema.parse(options.seed);
  let initialized = false;
  let lookupExpansion:
    | { aliases: MedicalAliasRecords; expand: ReturnType<typeof createAliasExpander> }
    | undefined;
  let indexedDocuments: readonly SearchDocumentDescriptor[] | undefined;
  let aliasesPromise: Promise<Result<MedicalAliasRecords, LocalMedError>> | undefined;
  let queryDocumentIndex: QueryDocumentIndex | undefined;
  let terminologyIndex: TerminologySearchIndex | undefined;
  let icdRecommendations: IcdRecommendationIndex | undefined;
  let searchDocumentsPromise: Promise<readonly SearchDocumentDescriptor[]> | undefined;
  let navigationDocumentsPromise:
    | Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>>
    | undefined;
  let documentSummariesPromise:
    | Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>>
    | undefined;

  const initialize = async (): Promise<Result<CoreStatus, LocalMedError>> => {
    try {
      aliasesPromise = undefined;
      lookupExpansion = undefined;
      indexedDocuments = undefined;
      documentSummariesPromise = undefined;
      navigationDocumentsPromise = undefined;
      searchDocumentsPromise = undefined;
      queryDocumentIndex = undefined;
      terminologyIndex = undefined;
      icdRecommendations = undefined;
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

  const getSearchDocuments = (): Promise<readonly SearchDocumentDescriptor[]> => {
    searchDocumentsPromise ??= (
      navigationDocumentsPromise
        ? navigationDocumentsPromise.then((result) => {
            if (!result.ok) throw result.error;
            return result.value.map((document) => ({
              id: document.id,
              title: document.title,
              shortTitle: document.shortTitle,
              sourceType: document.sourceType,
              metadata: document.metadata ?? {},
            }));
          })
        : options.store.listSearchDocuments
          ? options.store.listSearchDocuments()
          : options.store.listDocuments()
    ).catch((error: unknown) => {
      searchDocumentsPromise = undefined;
      queryDocumentIndex = undefined;
      terminologyIndex = undefined;
      throw error;
    });
    return searchDocumentsPromise;
  };

  const getAliases = async (): Promise<
    Result<Awaited<ReturnType<MedicalStore['listAliases']>>, LocalMedError>
  > => {
    aliasesPromise ??= (async () => {
      const ready = await ensureInitialized();
      if (!ready.ok) return err(ready.error);
      try {
        const aliases = filterQueryAliases(await options.store.listAliases());

        return ok(aliases);
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
    const [section, document] = await Promise.all([
      options.store.getSection(chunk.sectionId),
      options.store.getDocumentByVersionId(chunk.documentVersionId),
    ]);
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

  const runSearch = async (
    request: SearchRequest,
  ): Promise<Result<SearchResponse, LocalMedError>> => {
    const startedAt = performance.now();
    const parsed = { data: request };

    try {
      const aliasesResult = await getAliases();
      if (!aliasesResult.ok) return err(aliasesResult.error);
      if (
        parsed.data.analysisMode === 'lookup' &&
        lookupExpansion?.aliases !== aliasesResult.value
      ) {
        lookupExpansion = {
          aliases: aliasesResult.value,
          expand: createAliasExpander(aliasesResult.value),
        };
      }
      // Subject-based pruning of lookup results is a lexical-search rule: a hybrid result often
      // reaches a document whose title lacks the typed words, by meaning.
      const lexicalOnly = parsed.data.mode === 'lexical' || !options.embedder;
      let plan: ReturnType<typeof buildLookupQueryPlan> =
        parsed.data.analysisMode === 'lookup'
          ? buildLookupQueryPlan(
              parsed.data.query,
              aliasesResult.value,
              lookupExpansion?.expand(parsed.data.query),
              { boundShortTerms: lexicalOnly },
            )
          : analyzeClinicalQuery(
              parsed.data.query,
              aliasesResult.value,
              parsed.data.includeSuggestions,
            );
      const identities =
        parsed.data.analysisMode === 'lookup' &&
        !parsed.data.filters.specialties?.length &&
        !parsed.data.filters.ageGroups?.length &&
        !parsed.data.filters.sectionTypes?.length
          ? ((await options.store.lookupCoreIdentities?.(parsed.data.query)) ?? []).filter(
              (hit) =>
                !parsed.data.filters.documentIds?.length ||
                (hit.target.type === 'document' &&
                  parsed.data.filters.documentIds.includes(hit.target.documentId)),
            )
          : [];
      if (plan.branches.length === 0 && identities.length === 0) {
        return err(localMedError('INVALID_REQUEST', 'Search query has no searchable terms.'));
      }

      const documents = await getSearchDocuments();
      if (indexedDocuments !== documents || !queryDocumentIndex || !terminologyIndex) {
        queryDocumentIndex = new QueryDocumentIndex(documents);
        terminologyIndex = new TerminologySearchIndex(documents);
        icdRecommendations = undefined;
        indexedDocuments = documents;
      }
      const documentIndex = queryDocumentIndex;
      const termIndex = terminologyIndex;
      const terminologyMatch =
        parsed.data.analysisMode === 'lookup' ? termIndex.match(parsed.data.query) : undefined;
      const terminologySearches = terminologyMatch
        ? termIndex.searches(terminologyMatch, parsed.data.filters)
        : [];
      const perBranchLimit = Math.max(parsed.data.limit * 5, 50);
      const runBranchSearches = (
        searches: readonly {
          readonly branch: (typeof plan.branches)[number];
          readonly filters: SearchFilters;
        }[],
      ) =>
        Promise.all(
          searches.map(async ({ branch, filters }) => {
            const branchStartedAt = performance.now();
            const hits = await options.store.search({
              ftsQuery: branch.ftsQuery,
              terms: branch.terms,
              filters,
              limit: perBranchLimit,
              diversifyDocuments: parsed.data.analysisMode === 'lookup',
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
      const spelling = 'medicationSpelling' in plan ? plan.medicationSpelling : undefined;
      const baseBranches = spelling ? spelling.withoutSpelling.branches : plan.branches;
      const [baseSearches, terminologyBranchSearches] = await Promise.all([
        runBranchSearches(baseBranches.map((branch) => ({ branch, filters: parsed.data.filters }))),
        runBranchSearches(terminologySearches),
      ]);
      let spellingSearches: Awaited<ReturnType<typeof runBranchSearches>> = [];
      if (spelling) {
        if (
          hitsContainExactSubject(
            [...baseSearches, ...terminologyBranchSearches].flatMap(({ hits }) => hits),
            spelling.subject,
          )
        ) {
          // The typed word exists in the searched source text, so it is not a misspelling here.
          plan = spelling.withoutSpelling;
        } else {
          const baseIds = new Set(baseBranches.map((branch) => branch.id));
          spellingSearches = await runBranchSearches(
            plan.branches
              .filter((branch) => !baseIds.has(branch.id))
              .map((branch) => ({ branch, filters: parsed.data.filters })),
          );
        }
      }
      // A query that names an audience («менингит у ребёнка») also asks the title column for the
      // subject and the audience together («Вирусные менингиты у детей»): the body text of hundreds
      // of other mentions would otherwise leave that title out of the candidate window.
      const titleRescue = lexicalOnly ? plan.lookupTitleRescue : undefined;
      const titleSearches = titleRescue
        ? await runBranchSearches([{ branch: titleRescue.branch, filters: parsed.data.filters }])
        : [];
      const branchSearches = [
        ...baseSearches,
        ...spellingSearches,
        ...terminologyBranchSearches,
        ...titleSearches,
      ];
      const branchHits = branchSearches.map(({ branch, hits }) => ({ branch, hits }));
      const branchDiagnostics = branchSearches.map(({ diagnostics }) => diagnostics);

      const exactAliasDocumentIds = new Set([
        ...documentIndex.exactAliasIds(parsed.data.query),
        ...(terminologyMatch?.documents.map((entry) => entry.documentId) ?? []),
        ...(terminologyMatch?.related.map((entry) => entry.documentId) ?? []),
      ]);
      const exactTitleDocumentIds = documentIndex.exactTitleIds(parsed.data.query);
      const exactNavigationAliasDocumentIds = documentIndex.exactNavigationAliasIds(
        parsed.data.query,
      );
      const exactShortTitleDocumentIds = documentIndex.exactShortTitleIds(parsed.data.query);
      // A typed МКБ-10 code names its own card before any longer code of the same category.
      const exactIcdCardDocumentIds = new Set(documentIndex.exactIcdCardIds(parsed.data.query));
      const exactSecondaryIdentityDocumentIds = new Set([
        ...exactNavigationAliasDocumentIds,
        ...exactShortTitleDocumentIds,
        ...exactIcdCardDocumentIds,
      ]);
      const exactIdentityDocumentIds = new Set([
        ...exactTitleDocumentIds,
        ...exactSecondaryIdentityDocumentIds,
      ]);
      // Spelling alternatives are navigation candidates, never exact matches or medication facts.
      const spellingDocumentIds = new Set(
        ('medicationSpellingNames' in plan ? (plan.medicationSpellingNames ?? []) : [])
          .flatMap((name) => [...documentIndex.exactIdentityIds(name)])
          .slice(0, 40),
      );
      // Keep exact names and every declared meaning through the chunk cutoff for document ranking.
      const lexicalResults = fuseBranchHits(
        branchHits,
        perBranchLimit,
        parsed.data.query,
        exactAliasDocumentIds,
        lexicalOnly && parsed.data.analysisMode === 'lookup',
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
              options.embedder.input === 'original-query'
                ? parsed.data.query
                : semanticQueryText(plan.analysis),
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
              options.embedder?.fusion ?? LEGACY_SEMANTIC_FUSION,
            );
      // Semantic-only retrieval and hybrid truncation may discard an identity that survived
      // lexical fusion. Reuse its source-backed lexical hits before reading missing identities.
      const retainedResults = mergeExactIdentityResults(
        rankedResults,
        lexicalResults.filter((result) => exactIdentityDocumentIds.has(result.documentId)),
      );
      const retainedDocumentIds = new Set(retainedResults.map((result) => result.documentId));
      const missingExactIdentityDocumentIds = new Set(
        [...exactIdentityDocumentIds].filter((documentId) => !retainedDocumentIds.has(documentId)),
      );
      const exactIdentityResults = await buildExactIdentityResults(
        options.store,
        missingExactIdentityDocumentIds,
        parsed.data.filters,
        plan.terms,
        baseBranches.slice(0, 1).map((branch) => branch.ftsQuery),
      );
      const spellingResults = await buildExactIdentityResults(
        options.store,
        new Set([...spellingDocumentIds].filter((id) => !retainedDocumentIds.has(id))),
        parsed.data.filters,
        plan.terms,
        spellingSearches.map(({ branch }) => branch.ftsQuery),
        true,
      );
      const availableDocumentIds = documentIndex.availableIds;
      const results = filterSupersededSummaryResults(
        mergeExactIdentityResults(retainedResults, [...exactIdentityResults, ...spellingResults]),
        availableDocumentIds,
      );
      const candidateIds = new Set([
        ...branchHits.flatMap((item) => item.hits.map((hit) => hit.chunk.id)),
        ...vectorHits.map((hit) => hit.chunk.id),
        ...exactIdentityResults.map((result) => result.chunkId),
        ...spellingResults.map((result) => result.chunkId),
      ]);
      const groupedResults = filterSuffixFallbackGroups(
        groupResults(
          results,
          requestedSectionType(plan.analysis.normalizedQuery),
          !/ограничен/u.test(plan.analysis.normalizedQuery),
          plan.analysis.normalizedQuery,
          plan.terms,
          aliasesResult.value,
          [...new Set(results.map((result) => result.documentId))].flatMap((id) => {
            const document = documentIndex.byId.get(id);
            return document ? [document] : [];
          }),
          plan.analysis,
          lexicalOnly ? plan.lookupTermGroups : undefined,
        ),
        plan.analysis.normalizedQuery,
        aliasesResult.value,
        new Set([...exactIdentityDocumentIds, ...spellingDocumentIds]),
      );
      const subjectGroups =
        parsed.data.analysisMode === 'lookup' && lexicalOnly && !terminologyMatch
          ? dropGroupsWithoutSubject(
              groupedResults,
              plan.lookupTermGroups,
              new Set([
                ...exactIdentityDocumentIds,
                ...spellingDocumentIds,
                ...exactAliasDocumentIds,
              ]),
            )
          : groupedResults;
      const termRankedGroups = termIndex.rank(subjectGroups, terminologyMatch);
      const rankedGroups = (
        parsed.data.analysisMode === 'lookup' &&
        lexicalOnly &&
        isSymptomPhraseQuery(parsed.data.query)
          ? prioritizeSymptomLevelGroups(termRankedGroups, documentIndex.byId)
          : termRankedGroups
      ).toSorted(
        (left, right) =>
          Number(exactTitleDocumentIds.has(right.documentId)) -
            Number(exactTitleDocumentIds.has(left.documentId)) ||
          Number(exactSecondaryIdentityDocumentIds.has(right.documentId)) -
            Number(exactSecondaryIdentityDocumentIds.has(left.documentId)) ||
          Number(spellingDocumentIds.has(right.documentId)) -
            Number(spellingDocumentIds.has(left.documentId)),
      );
      const bridgeTuning = icdBridgeTuning(options.icdBridge, parsed.data.analysisMode);
      let finalGroups: readonly SearchResultGroup[] = rankedGroups;
      if (bridgeTuning) {
        icdRecommendations ??= new IcdRecommendationIndex(documents);
        finalGroups = await bridgeIcdRecommendations({
          groups: rankedGroups,
          documentIndex,
          recommendations: icdRecommendations,
          tuning: bridgeTuning,
          store: options.store,
          filters: parsed.data.filters,
          terms: plan.terms,
          ftsQueries: baseBranches.slice(0, 1).map((branch) => branch.ftsQuery),
          query: parsed.data.query,
          pinnedIds: new Set([
            ...exactIdentityDocumentIds,
            ...spellingDocumentIds,
            ...exactAliasDocumentIds,
          ]),
          group: (bridgedResults) =>
            groupResults(
              bridgedResults,
              null,
              false,
              plan.analysis.normalizedQuery,
              plan.terms,
              aliasesResult.value,
              [...new Set(bridgedResults.map((result) => result.documentId))].flatMap((id) => {
                const document = documentIndex.byId.get(id);
                return document ? [document] : [];
              }),
              plan.analysis,
              undefined,
            ),
        });
      }
      return ok({
        requestId: requestId(),
        identities,
        normalizedQuery: plan.analysis.normalizedQuery,
        elapsedMs: performance.now() - startedAt,
        modeUsed,
        analysis: plan.analysis,
        suggestions: plan.analysis.suggestions,
        groups: await withMedicationOverviews({
          groups: collapseGroupsByTargetDocument(finalGroups, documentIndex.byId).slice(
            0,
            parsed.data.limit,
          ),
          enabled:
            parsed.data.analysisMode === 'lookup' &&
            requestedSectionType(plan.analysis.normalizedQuery) === null &&
            !hasMedicationFormFacts(plan.analysis),
          named: new Set([...exactIdentityDocumentIds, ...exactAliasDocumentIds]),
          documentIndex,
          store: options.store,
          filters: parsed.data.filters,
          terms: plan.terms,
        }),
        diagnostics: {
          ftsQuery: branchDiagnostics.map((branch) => branch.ftsQuery).join(' || '),
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
  };

  /** Item 3 (S3): see `name-variant-fallback.ts`; the typed query's response stays unless replaced. */
  const withNameVariantFallback = async (
    request: SearchRequest,
    primary: SearchResponse,
    index: QueryDocumentIndex,
  ): Promise<Result<SearchResponse, LocalMedError>> => {
    if (responseNamesQuery(primary, request.query, index)) return ok(primary);
    for (const candidate of nameVariantCandidates(request.query, index)) {
      const alternative = await runSearch({ ...request, query: candidate.query });
      if (!alternative.ok || !responseNamesQuery(alternative.value, candidate.query, index))
        continue;
      return ok({
        ...alternative.value,
        elapsedMs: primary.elapsedMs + alternative.value.elapsedMs,
        queryRewrite: { kind: candidate.kind, query: candidate.query },
      });
    }
    return ok(primary);
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

    async listNavigationDocuments() {
      navigationDocumentsPromise ??= (async () => {
        try {
          const ready = await ensureInitialized();
          if (!ready.ok) return err(ready.error);
          const documents = await (options.store.listNavigationDocuments
            ? options.store.listNavigationDocuments()
            : options.store.listDocuments());
          return ok(documents.map(toDocumentSummary));
        } catch (error) {
          return err(asLocalMedError(error));
        }
      })();
      const result = await navigationDocumentsPromise;
      if (!result.ok) navigationDocumentsPromise = undefined;
      return result;
    },

    async listSearchDocuments() {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const documents = await getSearchDocuments();
        return ok(
          documents.map((document) => ({
            ...document,
            ageGroups: metadataStrings(document.metadata, 'ageGroups'),
          })),
        );
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
      const parsed = SearchRequestSchema.safeParse(untrustedRequest);
      if (!parsed.success) {
        return err(
          localMedError('INVALID_REQUEST', 'Search request is invalid.', {
            issues: parsed.error.issues,
          }),
        );
      }
      const primary = await runSearch(parsed.data);
      if (
        options.nameVariants === false ||
        !primary.ok ||
        parsed.data.analysisMode !== 'lookup' ||
        !queryDocumentIndex
      )
        return primary;
      return withNameVariantFallback(parsed.data, primary.value, queryDocumentIndex);
    },

    async reference(request) {
      try {
        const ready = await ensureInitialized();
        if (!ready.ok) return err(ready.error);
        const parsed = DefinitionReferenceRequestSchema.safeParse(request);
        if (!parsed.success)
          return err(localMedError('INVALID_REQUEST', 'Invalid reference request.'));
        return ok(
          options.store.reference
            ? await options.store.reference(parsed.data)
            : { op: 'unavailable' as const },
        );
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
        const [sectionRecords, chunkRecords] = await Promise.all([
          options.store.getSectionsByDocument(documentId),
          options.store.getChunksByDocument(documentId),
        ]);
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
      lookupExpansion = undefined;
      indexedDocuments = undefined;
      documentSummariesPromise = undefined;
      navigationDocumentsPromise = undefined;
      searchDocumentsPromise = undefined;
      queryDocumentIndex = undefined;
      terminologyIndex = undefined;
      icdRecommendations = undefined;
    },
  };
}
