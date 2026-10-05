import type { CoreIdentityHit } from '@localmed/contracts/core-identities';
import { z } from 'zod';
import type { TerminologyMatchKind } from './terminology';

export const SearchModeSchema = z.enum(['auto', 'lexical', 'semantic', 'hybrid']);

export const SearchFiltersSchema = z.object({
  documentIds: z.array(z.string().min(1)).optional(),
  specialties: z.array(z.string().min(1)).optional(),
  ageGroups: z.array(z.string().min(1)).optional(),
  sectionTypes: z.array(z.string().min(1)).optional(),
});

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  mode: SearchModeSchema.default('auto'),
  analysisMode: z.enum(['lookup', 'clinical']).optional(),
  filters: SearchFiltersSchema.default({}),
  limit: z.number().int().min(1).max(100).default(20),
  includeSuggestions: z.boolean().default(true),
});

export const AnalyzeQueryRequestSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  includeSuggestions: z.boolean().default(true),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type AnalyzeQueryRequest = z.infer<typeof AnalyzeQueryRequestSchema>;
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;
export type SearchMode = z.infer<typeof SearchModeSchema>;

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export type QueryFactKind =
  | 'age'
  | 'sex'
  | 'duration'
  | 'temperature'
  | 'measurement'
  | 'symptom'
  | 'investigation'
  | 'medication'
  | 'location'
  | 'epidemiology'
  | 'negative-finding'
  | 'weight'
  | 'route'
  | 'dose-form'
  | 'strength'
  | 'frequency'
  | 'gestational-age'
  | 'pregnancy'
  | 'organ-function'
  | 'allergy';

export type LegacyQueryFactKind = Exclude<
  QueryFactKind,
  | 'weight'
  | 'route'
  | 'dose-form'
  | 'strength'
  | 'frequency'
  | 'gestational-age'
  | 'pregnancy'
  | 'organ-function'
  | 'allergy'
>;

export type ClinicalContextFactKind =
  | 'age'
  | 'measurement'
  | 'weight'
  | 'route'
  | 'dose-form'
  | 'strength'
  | 'frequency'
  | 'gestational-age'
  | 'pregnancy'
  | 'organ-function'
  | 'allergy';

export type QueryFactPolarity = 'positive' | 'negative' | 'uncertain';

export interface QueryFact<Kind extends QueryFactKind = LegacyQueryFactKind> {
  readonly id: string;
  readonly kind: Kind;
  readonly label: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly unit: string | null;
  readonly polarity: QueryFactPolarity;
  readonly range: TextRange;
}

export type ClinicalContextFact<Kind extends ClinicalContextFactKind = ClinicalContextFactKind> =
  QueryFact<Kind>;

export interface QueryClinicalContext {
  readonly age: readonly ClinicalContextFact<'age'>[];
  readonly gestationalAge: readonly ClinicalContextFact<'gestational-age'>[];
  readonly sex: readonly QueryFact<'sex'>[];
  readonly duration: readonly QueryFact<'duration'>[];
  readonly weight: readonly ClinicalContextFact<'weight'>[];
  readonly route: readonly ClinicalContextFact<'route'>[];
  readonly doseForm: readonly ClinicalContextFact<'dose-form'>[];
  readonly strength: readonly ClinicalContextFact<'strength'>[];
  readonly frequency: readonly ClinicalContextFact<'frequency'>[];
  readonly measurements: readonly ClinicalContextFact<'measurement'>[];
  readonly positiveFindings: readonly QueryFact[];
  readonly negativeFindings: readonly QueryFact[];
  readonly currentMedicines: readonly QueryFact<'medication'>[];
  readonly pregnancy: readonly ClinicalContextFact<'pregnancy'>[];
  readonly organFunction: readonly ClinicalContextFact<'organ-function'>[];
  readonly allergies: readonly ClinicalContextFact<'allergy'>[];
}

export type SearchIntentKind =
  | 'diagnosis'
  | 'treatment'
  | 'medication'
  | 'disease-reference'
  | 'care-guidance'
  | 'administrative-reference'
  | 'mixed'
  | 'unknown';

export interface QueryIntent {
  readonly primary: SearchIntentKind;
  readonly secondary: readonly SearchIntentKind[];
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
  readonly needsClarification: boolean;
}

export interface QueryMedicationCandidate {
  readonly canonicalTerm: string;
  readonly matchedText: string;
  readonly matchType: 'exact' | 'fuzzy';
}

export interface QueryMedicationDoseCalculation {
  readonly kind: 'medication-dose';
  readonly medicationCandidates: readonly QueryMedicationCandidate[];
}

export interface QueryInfusionVolumeCalculation {
  readonly kind: 'infusion-volume';
}

export type QueryCalculation = QueryMedicationDoseCalculation | QueryInfusionVolumeCalculation;

export type QueryBranchKind =
  | 'clinical'
  | 'original'
  | 'clause'
  | 'investigation'
  | 'medication'
  | 'intent';

export interface QueryBranch {
  readonly id: string;
  readonly kind: QueryBranchKind;
  readonly label: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly terms: readonly string[];
  readonly weight: number;
}

export type SearchSuggestionField =
  | 'age'
  | 'sex'
  | 'duration'
  | 'temperature'
  | 'medications'
  | 'investigations'
  | 'epidemiology'
  | 'diagnosis'
  | 'severity'
  | 'control'
  | 'weight'
  | 'context'
  | 'goal';

export interface SearchSuggestion {
  readonly id: string;
  readonly field: SearchSuggestionField;
  readonly label: string;
  readonly insertion: string;
  readonly detail: string;
  readonly priority: number;
  readonly kind: 'missing-field' | 'query-refinement';
}

export interface QueryAnalysis {
  readonly originalQuery: string;
  readonly normalizedQuery: string;
  readonly intent?: QueryIntent;
  readonly calculation?: QueryCalculation;
  readonly facts: readonly QueryFact[];
  /** Optional for adapters that only return a legacy analysis; lexical analysis populates it. */
  readonly clinicalContext?: QueryClinicalContext;
  readonly branches: readonly QueryBranch[];
  readonly suggestions: readonly SearchSuggestion[];
  readonly warnings: readonly string[];
}

export type SearchResultCategory =
  | 'overview'
  | 'clinical-picture'
  | 'differential-diagnosis'
  | 'diagnostics'
  | 'treatment'
  | 'routing'
  | 'follow-up'
  | 'other';

export interface SearchResult {
  /** Stable canonical knowledge identity when the hit is a concept-backed card. */
  readonly conceptId?: string;
  /** Source-backed occurrence index; not a generated clinical inference. */
  readonly terminologyConceptIds?: readonly string[];
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sectionId: string;
  readonly anchor: string;
  readonly title: string;
  readonly sectionPath: readonly string[];
  readonly snippet: string;
  readonly highlightedRanges: readonly TextRange[];
  readonly lexicalScore: number;
  readonly semanticScore: number | null;
  readonly finalScore: number;
  readonly matchedTerms: readonly string[];
  readonly matchedBranches: readonly string[];
  readonly sectionType: string | null;
  readonly category: SearchResultCategory;
}

export interface SearchResultGroup {
  /** Present only when every grouped hit resolves to the same canonical concept. */
  readonly conceptId?: string;
  readonly terminologyMatch?: TerminologyMatchKind;
  readonly documentId: string;
  readonly title: string;
  readonly bestScore: number;
  readonly categories: readonly SearchResultCategory[];
  readonly documentKind?:
    | 'medication'
    | 'clinical-recommendation'
    | 'legal'
    | 'calculator'
    | 'assessment'
    | 'reference';
  readonly ageGroups?: readonly string[];
  readonly contentKind?: 'summary' | 'pointer' | 'full-text';
  readonly results: readonly SearchResult[];
}

export interface SearchBranchDiagnostics {
  readonly id: string;
  readonly label: string;
  readonly ftsQuery: string;
  readonly candidateCount: number;
  readonly elapsedMs: number;
  readonly weight: number;
}

export type SemanticSearchStatus = 'disabled' | 'used' | 'fallback';

export interface SemanticSearchDiagnostics {
  readonly status: SemanticSearchStatus;
  readonly requestedMode: SearchMode;
  readonly profileId: string | null;
  readonly candidateCount: number;
  readonly elapsedMs: number;
  readonly fallbackReason: string | null;
}

export interface SearchDiagnostics {
  readonly ftsQuery: string;
  readonly candidateCount: number;
  readonly aliasMatches: readonly string[];
  readonly terms: readonly string[];
  readonly branches: readonly SearchBranchDiagnostics[];
  readonly semantic: SemanticSearchDiagnostics;
}

/**
 * One corpus-vocabulary spelling correction applied to a single unknown query word, and the
 * resulting query actually searched. Populated only by the offline corpus-typo fallback (see
 * `@localmed/search-lexical`'s `correctQueryAgainstVocabulary`): the *original* query returned
 * nothing useful, every corrected word is unknown to the corpus vocabulary on its own, and the
 * *corrected* query is what actually produced `SearchResponse.groups`. Never applied when the
 * original query already found something — this is strictly a last-resort fallback, not a
 * silent rewrite of a working query.
 *
 * UI copy convention (not enforced here — no UI files are part of this contract): render as
 * «Показаны результаты по: {correctedQuery}», the same phrasing already used for the existing
 * medication-spelling fallback's alternative-name branches.
 */
export interface QueryWordCorrection {
  readonly original: string;
  readonly corrected: string;
  /** RapidFuzz OSA `normalized_similarity` in `[0, 1]` between `original` and `corrected`. */
  readonly score: number;
}

export interface QueryCorrection {
  readonly correctedQuery: string;
  readonly corrections: readonly QueryWordCorrection[];
}

/**
 * How a typed name was reinterpreted when the typed form named nothing in the searched documents
 * (roadmap item 3): `layout` — the same keys on the other keyboard layout («vtnajhvby» →
 * «метформин»); `transliteration` — a Latin spelling read as a Russian name («nurofen» →
 * «нурофен»); `layout-transliteration` — Latin typed on the Russian layout («ьуеащкьшт» →
 * «метформин»); `latin-name` — the declared Latin name of a drug («Nurofen» → «Нурофен»).
 */
export type QueryRewriteKind =
  | 'layout'
  | 'transliteration'
  | 'layout-transliteration'
  | 'latin-name';

/**
 * Present only when a rewrite of the typed query produced `SearchResponse.groups`: the typed query
 * itself found no title or alias naming it. UI copy: «Показаны результаты по: {query}».
 */
export interface QueryRewrite {
  readonly kind: QueryRewriteKind;
  readonly query: string;
}

export interface SearchResponse {
  /** Exact source names outside clinical FTS; each target must be resolved before opening. */
  readonly identities?: readonly CoreIdentityHit[];
  readonly requestId: string;
  readonly normalizedQuery: string;
  readonly elapsedMs: number;
  readonly modeUsed: 'lexical' | 'semantic' | 'hybrid';
  readonly analysis: QueryAnalysis;
  readonly suggestions: readonly SearchSuggestion[];
  readonly groups: readonly SearchResultGroup[];
  readonly diagnostics: SearchDiagnostics;
  /** Present only when the corpus-typo fallback corrected and re-ran the query; see above. */
  readonly queryCorrection?: QueryCorrection;
  /** Present only when the layout / transliteration fallback replaced the typed query. */
  readonly queryRewrite?: QueryRewrite;
}
