import { z } from 'zod';

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
  | 'negative-finding';

export type QueryFactPolarity = 'positive' | 'negative' | 'uncertain';

export interface QueryFact {
  readonly id: string;
  readonly kind: QueryFactKind;
  readonly label: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly unit: string | null;
  readonly polarity: QueryFactPolarity;
  readonly range: TextRange;
}

export type QueryBranchKind = 'clinical' | 'original' | 'clause' | 'investigation' | 'medication';

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
  | 'epidemiology';

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
  readonly facts: readonly QueryFact[];
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
  readonly documentId: string;
  readonly title: string;
  readonly bestScore: number;
  readonly categories: readonly SearchResultCategory[];
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

export interface SearchResponse {
  readonly requestId: string;
  readonly normalizedQuery: string;
  readonly elapsedMs: number;
  readonly modeUsed: 'lexical' | 'semantic' | 'hybrid';
  readonly analysis: QueryAnalysis;
  readonly suggestions: readonly SearchSuggestion[];
  readonly groups: readonly SearchResultGroup[];
  readonly diagnostics: SearchDiagnostics;
}
