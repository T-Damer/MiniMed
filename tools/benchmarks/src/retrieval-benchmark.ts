// Retrieval benchmark over the FULL databases with document-level graded relevance
// (docs/research/query-datasets-2026-10.md). Rows come from external, openly licensed Russian
// datasets (patient complaints and doctor diagnosis phrases labelled with ICD-10 codes, forum drug
// questions); relevance is derived from the code or drug name, never judged by the engine under
// test. This module is pure: loading, ICD matching, ranking metrics. Building the dataset is
// `build-retrieval-benchmark.ts`, running it against the engine is `run-retrieval-benchmark.ts`.
import { readFileSync } from 'node:fs';

export type RetrievalSplit = 'dev' | 'test';
export type RelevantKind = 'clinical-recommendation' | 'mkb-card' | 'medication';
/** 3 = the document answers the code/drug (same or hierarchically related ICD code), 1 = same 3-character ICD block. */
export type RelevanceGrade = 1 | 3;

export interface RetrievalSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly attribution: string;
  /** Whether the rows may live in this repository; otherwise the dataset stays under data/. */
  readonly redistributable: boolean;
}

export interface RelevantDocument {
  readonly documentId: string;
  readonly grade: RelevanceGrade;
  readonly kind: RelevantKind;
}

export interface RetrievalQuery {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  /** Identifier of the record in the source dataset (visit id, file number, row number). */
  readonly sourceRecordId: string;
  readonly split: RetrievalSplit;
  readonly style: 'complaint' | 'diagnosis-phrase' | 'drug-question-title' | 'drug-question-text';
  readonly machineTranslated: boolean;
  /** ICD-10 codes the source assigned (empty for drug rows). */
  readonly goldCodes: readonly string[];
  /** Medication names the relevance was derived from (empty for ICD rows). */
  readonly goldNames: readonly string[];
  readonly relevant: readonly RelevantDocument[];
}

export interface RetrievalBenchmark {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly description: string;
  readonly builtAt: string;
  readonly corpus: {
    readonly clinicalRecommendations: number;
    readonly mkbCards: number;
    readonly note: string;
  };
  readonly sources: readonly RetrievalSource[];
  /** Checksums of the downloaded source files the rows were built from. */
  readonly sourceFiles?: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
  readonly queries: readonly RetrievalQuery[];
}

const STYLES = new Set([
  'complaint',
  'diagnosis-phrase',
  'drug-question-title',
  'drug-question-text',
]);
const KINDS = new Set(['clinical-recommendation', 'mkb-card', 'medication']);

export function parseRetrievalBenchmark(value: unknown): RetrievalBenchmark {
  if (typeof value !== 'object' || value === null) throw new Error('Benchmark must be an object.');
  const benchmark = value as Partial<RetrievalBenchmark>;
  if (benchmark.schemaVersion !== 1) throw new Error('Unsupported retrieval benchmark schema.');
  if (!Array.isArray(benchmark.sources) || !Array.isArray(benchmark.queries)) {
    throw new Error('Benchmark needs sources and queries.');
  }
  const sourceIds = new Set<string>();
  for (const source of benchmark.sources as readonly RetrievalSource[]) {
    if (!source.id || !source.licence || !source.licenceUrl || !source.url) {
      throw new Error(`Source ${source.id ?? '?'} lacks id, url or licence.`);
    }
    sourceIds.add(source.id);
  }
  const ids = new Set<string>();
  for (const [index, row] of (benchmark.queries as readonly RetrievalQuery[]).entries()) {
    const where = `Query ${index + 1} (${row.id ?? '?'})`;
    if (typeof row.id !== 'string' || typeof row.query !== 'string' || row.query.trim() === '') {
      throw new Error(`${where} needs id and query text.`);
    }
    if (ids.has(row.id)) throw new Error(`${where}: duplicate id.`);
    ids.add(row.id);
    if (!sourceIds.has(row.source)) throw new Error(`${where}: unknown source ${row.source}.`);
    if (row.split !== 'dev' && row.split !== 'test') throw new Error(`${where}: bad split.`);
    if (!STYLES.has(row.style)) throw new Error(`${where}: bad style.`);
    if (typeof row.machineTranslated !== 'boolean') throw new Error(`${where}: machineTranslated.`);
    if (!Array.isArray(row.relevant) || row.relevant.length === 0) {
      throw new Error(`${where}: no relevant documents.`);
    }
    if (!row.relevant.some((doc) => doc.grade === 3))
      throw new Error(`${where}: no grade-3 document.`);
    for (const doc of row.relevant) {
      if (
        typeof doc.documentId !== 'string' ||
        !KINDS.has(doc.kind) ||
        (doc.grade !== 1 && doc.grade !== 3)
      ) {
        throw new Error(`${where}: malformed relevant document.`);
      }
    }
  }
  return benchmark as RetrievalBenchmark;
}

export function loadRetrievalBenchmark(path: string): RetrievalBenchmark {
  return parseRetrievalBenchmark(JSON.parse(readFileSync(path, 'utf8')));
}

// ---------------------------------------------------------------------------------------------
// ICD-10 matching

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
};

/** `к29.5` / `К29.5` (Cyrillic К) → `K29.5`; null when the text is not a code. */
export function normalizeIcdCode(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  const code = [...upper].map((char) => CYRILLIC_TO_LATIN[char] ?? char).join('');
  return /^[A-Z]\d{2}(?:\.\d{1,2})?$/u.test(code) ? code : null;
}

export const icdBlock = (code: string): string => code.slice(0, 3);

const RANGE = /^([A-Z]\d{2})\s*-\s*([A-Z]\d{2})$/u;

/**
 * `exact`: the codes are the same or one contains the other (`K29` covers `K29.5`; a range such as
 * `C00-C14` covers `C02.1`). `block`: different codes of the same 3-character block. null otherwise.
 */
export function icdRelation(gold: string, candidate: string): 'exact' | 'block' | null {
  const range = RANGE.exec(candidate.trim().toUpperCase());
  if (range?.[1] && range[2]) {
    const block = icdBlock(gold);
    return block >= range[1] && block <= range[2] ? 'exact' : null;
  }
  const normalized = normalizeIcdCode(candidate);
  if (normalized === null) return null;
  if (
    normalized === gold ||
    gold.startsWith(`${normalized}.`) ||
    normalized.startsWith(`${gold}.`)
  ) {
    return 'exact';
  }
  return icdBlock(normalized) === icdBlock(gold) ? 'block' : null;
}

/** The strongest relation of any candidate code to any gold code. */
export function bestRelation(
  goldCodes: readonly string[],
  candidates: readonly string[],
): 'exact' | 'block' | null {
  let best: 'exact' | 'block' | null = null;
  for (const gold of goldCodes) {
    for (const candidate of candidates) {
      const relation = icdRelation(gold, candidate);
      if (relation === 'exact') return 'exact';
      if (relation === 'block') best = 'block';
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Scoring

export interface QueryScore {
  readonly id: string;
  readonly source: string;
  readonly split: RetrievalSplit;
  /** 1-based rank of the first grade-3 document within the examined depth, else null. */
  readonly exactRank: number | null;
  /** First grade-1-or-3 document. */
  readonly anyRank: number | null;
  /** First grade-3 clinical recommendation; undefined when the query has none to find. */
  readonly recommendationRank: number | null | undefined;
  readonly mkbRank: number | null | undefined;
  readonly ndcgAt10: number;
}

export const DEPTH = 20;
const GAIN: Readonly<Record<RelevanceGrade, number>> = { 1: 1, 3: 3 };

function firstRank(
  ranked: readonly string[],
  accepted: (documentId: string) => boolean,
): number | null {
  const index = ranked.slice(0, DEPTH).findIndex(accepted);
  return index >= 0 ? index + 1 : null;
}

export function scoreQuery(
  query: RetrievalQuery,
  rankedDocumentIds: readonly string[],
): QueryScore {
  const grades = new Map(query.relevant.map((doc) => [doc.documentId, doc]));
  // A document may be returned twice (pointer plus module); count each document once.
  const ranked = [...new Set(rankedDocumentIds)];
  const hasKind = (kind: RelevantKind) =>
    query.relevant.some((doc) => doc.kind === kind && doc.grade === 3);
  const ofKind = (kind: RelevantKind) => (documentId: string) => {
    const doc = grades.get(documentId);
    return doc !== undefined && doc.kind === kind && doc.grade === 3;
  };
  const dcg = ranked.slice(0, 10).reduce((sum, documentId, index) => {
    const doc = grades.get(documentId);
    return doc ? sum + GAIN[doc.grade] / Math.log2(index + 2) : sum;
  }, 0);
  const ideal = query.relevant
    .map((doc) => GAIN[doc.grade])
    .toSorted((left, right) => right - left)
    .slice(0, 10)
    .reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  return {
    id: query.id,
    source: query.source,
    split: query.split,
    exactRank: firstRank(ranked, (id) => grades.get(id)?.grade === 3),
    anyRank: firstRank(ranked, (id) => grades.has(id)),
    recommendationRank: hasKind('clinical-recommendation')
      ? firstRank(ranked, ofKind('clinical-recommendation'))
      : undefined,
    mkbRank: hasKind('mkb-card') ? firstRank(ranked, ofKind('mkb-card')) : undefined,
    ndcgAt10: ideal === 0 ? 0 : dcg / ideal,
  };
}

export interface Aggregate {
  readonly queries: number;
  readonly recallAt1: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly recallAt20: number;
  readonly mrrAt10: number;
  readonly ndcgAt10: number;
  /** Recall@5 when a grade-1 (same block) document also counts. */
  readonly anyRecallAt5: number;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const within = (rank: number | null | undefined, depth: number) =>
  rank !== null && rank !== undefined && rank <= depth ? 1 : 0;

function aggregateRanks(
  scores: readonly QueryScore[],
  pick: (score: QueryScore) => number | null | undefined,
): Aggregate {
  const relevant = scores.filter((score) => pick(score) !== undefined);
  return {
    queries: relevant.length,
    recallAt1: mean(relevant.map((score) => within(pick(score), 1))),
    recallAt5: mean(relevant.map((score) => within(pick(score), 5))),
    recallAt10: mean(relevant.map((score) => within(pick(score), 10))),
    recallAt20: mean(relevant.map((score) => within(pick(score), 20))),
    mrrAt10: mean(
      relevant.map((score) => {
        const rank = pick(score);
        return rank !== null && rank !== undefined && rank <= 10 ? 1 / rank : 0;
      }),
    ),
    ndcgAt10: mean(relevant.map((score) => score.ndcgAt10)),
    anyRecallAt5: mean(relevant.map((score) => within(score.anyRank, 5))),
  };
}

/** Any grade-3 document (recommendation, МКБ card or medication) as the answer. */
export const aggregateExact = (scores: readonly QueryScore[]): Aggregate =>
  aggregateRanks(scores, (score) => score.exactRank);
/** Only queries that have a grade-3 recommendation; the rank of that recommendation. */
export const aggregateRecommendations = (scores: readonly QueryScore[]): Aggregate =>
  aggregateRanks(scores, (score) => score.recommendationRank);
export const aggregateMkb = (scores: readonly QueryScore[]): Aggregate =>
  aggregateRanks(scores, (score) => score.mkbRank);
