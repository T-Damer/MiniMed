// Row shape of the hard-query benchmark: the curated clinician set (curated-clinician-queries.json)
// and its scoring (hard-query-scoring.ts). The 1 500-row synthetic fixture this module once loaded was
// removed on 2026-10-02 (tools/benchmarks/HARD_BENCHMARK.md).
export type HardQuerySplit = 'dev' | 'validation' | 'hidden_test';
export type HardQueryStyle = 'professional' | 'colloquial' | 'keywords' | 'noisy' | 'case';
export type HardQueryAnswerability = 'answerable' | 'partial_or_no_answer';

export interface HardQueryGrading {
  readonly required_gain: number;
  readonly acceptable_gain: number;
  readonly irrelevant_gain: number;
  readonly forbidden_gain: number;
}

export interface HardMedicalQuery {
  readonly query_id: string;
  readonly scenario_id: string;
  readonly query: string;
  readonly language: 'ru';
  readonly domain: 'medicine';
  readonly specialty: string;
  readonly age_group: string;
  readonly intent: string;
  readonly style: HardQueryStyle;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly answerability: HardQueryAnswerability;
  readonly split: HardQuerySplit;
  readonly required_entities: readonly string[];
  readonly acceptable_entities: readonly string[];
  readonly forbidden_or_dangerous: readonly string[];
  readonly expected_sections: readonly string[];
  readonly expected_terms: readonly string[];
  readonly grading: HardQueryGrading;
}
