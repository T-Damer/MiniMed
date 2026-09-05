import type { SearchResultGroup } from '@localmed/contracts';

export const FULL_CORPUS_QUERY_COUNT = 500;

export type FullCorpusSourceFamily = 'diseases' | 'mkb-diseases';
export type FullCorpusQueryStyle =
  | 'exact-title'
  | 'primary-title'
  | 'parenthetical-synonym'
  | 'readable-prefixed-lookup'
  | 'section-intent'
  | 'code-only'
  | 'name-only'
  | 'code-and-name'
  | 'title-variant'
  | 'composition';

export interface FullCorpusSearchQuery {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly style: FullCorpusQueryStyle;
  readonly sourceFamily: FullCorpusSourceFamily;
  readonly expectedSectionType?: string;
}

export interface FullCorpusSearchFixture {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly description: string;
  readonly sourceFamily: FullCorpusSourceFamily;
  readonly queries: readonly FullCorpusSearchQuery[];
}

export interface FullCorpusSearchEvaluation {
  readonly queryId: string;
  readonly query: string;
  readonly style: FullCorpusQueryStyle;
  readonly sourceFamily: FullCorpusSourceFamily;
  readonly expectedDocumentIds: readonly string[];
  readonly foundDocumentIds: readonly string[];
  readonly recallAt5: number;
  readonly reciprocalRankAt5: number;
  readonly top1: boolean;
  readonly sectionRecallAt5: boolean | null;
  readonly elapsedMs: number;
  readonly topDocumentIds: readonly string[];
}

export interface FullCorpusSearchAggregate {
  readonly queryCount: number;
  readonly recallAt5: number;
  readonly mrrAt5: number;
  readonly top1: number;
  readonly sectionRecallAt5: number | null;
  readonly sectionQueryCount: number;
  readonly latencyMs: { readonly p50: number; readonly p95: number };
}

const STYLES = new Set<FullCorpusQueryStyle>([
  'exact-title',
  'primary-title',
  'parenthetical-synonym',
  'readable-prefixed-lookup',
  'section-intent',
  'code-only',
  'name-only',
  'code-and-name',
  'title-variant',
  'composition',
]);

const SOURCE_FAMILIES = new Set<FullCorpusSourceFamily>(['diseases', 'mkb-diseases']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function sourceFamily(value: unknown, path: string): FullCorpusSourceFamily {
  const result = nonEmptyString(value, path);
  if (!SOURCE_FAMILIES.has(result as FullCorpusSourceFamily)) {
    throw new Error(`${path} must be diseases or mkb-diseases.`);
  }
  return result as FullCorpusSourceFamily;
}

function style(value: unknown, path: string): FullCorpusQueryStyle {
  const result = nonEmptyString(value, path);
  if (!STYLES.has(result as FullCorpusQueryStyle)) throw new Error(`${path} has an unknown style.`);
  return result as FullCorpusQueryStyle;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error(`${path} must be a non-empty string array.`);
  }
  return value;
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${path} must not contain duplicate values.`);
}

function parseQuery(
  value: unknown,
  index: number,
  expectedSourceFamily: FullCorpusSourceFamily,
): FullCorpusSearchQuery {
  const path = `queries[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const id = nonEmptyString(field(value, 'id'), `${path}.id`);
  const query = nonEmptyString(field(value, 'query'), `${path}.query`);
  const expectedDocumentIds = stringArray(
    field(value, 'expectedDocumentIds'),
    `${path}.expectedDocumentIds`,
  );
  assertUnique(expectedDocumentIds, `${path}.expectedDocumentIds`);
  const queryStyle = style(field(value, 'style'), `${path}.style`);
  const querySourceFamily = sourceFamily(field(value, 'sourceFamily'), `${path}.sourceFamily`);
  if (querySourceFamily !== expectedSourceFamily) {
    throw new Error(`${path}.sourceFamily must match fixture sourceFamily.`);
  }
  const expectedSectionTypeValue = field(value, 'expectedSectionType');
  const expectedSectionType =
    expectedSectionTypeValue === undefined
      ? undefined
      : nonEmptyString(expectedSectionTypeValue, `${path}.expectedSectionType`);
  return expectedSectionType === undefined
    ? { id, query, expectedDocumentIds, style: queryStyle, sourceFamily: querySourceFamily }
    : {
        id,
        query,
        expectedDocumentIds,
        style: queryStyle,
        sourceFamily: querySourceFamily,
        expectedSectionType,
      };
}

export function validateFullCorpusSearchFixture(value: unknown): FullCorpusSearchFixture {
  if (!isRecord(value)) throw new Error('Full-corpus search fixture must be an object.');
  if (field(value, 'schemaVersion') !== 1)
    throw new Error('Unsupported full-corpus fixture schema.');
  const id = nonEmptyString(field(value, 'id'), 'id');
  const description = nonEmptyString(field(value, 'description'), 'description');
  const fixtureSourceFamily = sourceFamily(field(value, 'sourceFamily'), 'sourceFamily');
  const rawQueries = field(value, 'queries');
  if (!Array.isArray(rawQueries) || rawQueries.length !== FULL_CORPUS_QUERY_COUNT) {
    throw new Error(
      `Full-corpus search fixture must contain exactly ${FULL_CORPUS_QUERY_COUNT} queries.`,
    );
  }
  const queries = rawQueries.map((item, index) => parseQuery(item, index, fixtureSourceFamily));
  assertUnique(
    queries.map((item) => item.id),
    'queries.id',
  );
  assertUnique(
    queries.map((item) => item.query),
    'queries.query',
  );
  return { schemaVersion: 1, id, description, sourceFamily: fixtureSourceFamily, queries };
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function evaluateFullCorpusSearchQuery(
  query: FullCorpusSearchQuery,
  groups: readonly SearchResultGroup[],
  elapsedMs = 0,
): FullCorpusSearchEvaluation {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error('Search elapsedMs must be finite and non-negative.');
  const topGroups = groups.slice(0, 5);
  const topDocumentIds = topGroups.map((group) => group.documentId);
  const expected = new Set(query.expectedDocumentIds);
  const foundDocumentIds = topDocumentIds.filter(
    (documentId, index) => expected.has(documentId) && topDocumentIds.indexOf(documentId) === index,
  );
  const firstRank = topDocumentIds.findIndex((documentId) => expected.has(documentId));
  const sectionRecallAt5 =
    query.expectedSectionType === undefined
      ? null
      : topGroups.some(
          (group) =>
            expected.has(group.documentId) &&
            group.results.some((result) => result.sectionType === query.expectedSectionType),
        );
  return {
    queryId: query.id,
    query: query.query,
    style: query.style,
    sourceFamily: query.sourceFamily,
    expectedDocumentIds: query.expectedDocumentIds,
    foundDocumentIds,
    recallAt5: foundDocumentIds.length / expected.size,
    reciprocalRankAt5: firstRank < 0 ? 0 : 1 / (firstRank + 1),
    top1: firstRank === 0,
    sectionRecallAt5,
    elapsedMs,
    topDocumentIds,
  };
}

export function aggregateFullCorpusSearchEvaluations(
  rows: readonly FullCorpusSearchEvaluation[],
): FullCorpusSearchAggregate {
  const sectionRows = rows.filter((row) => row.sectionRecallAt5 !== null);
  return {
    queryCount: rows.length,
    recallAt5: mean(rows.map((row) => row.recallAt5)),
    mrrAt5: mean(rows.map((row) => row.reciprocalRankAt5)),
    top1: mean(rows.map((row) => Number(row.top1))),
    sectionRecallAt5:
      sectionRows.length === 0
        ? null
        : mean(sectionRows.map((row) => Number(row.sectionRecallAt5))),
    sectionQueryCount: sectionRows.length,
    latencyMs: {
      p50: percentile(
        rows.map((row) => row.elapsedMs),
        50,
      ),
      p95: percentile(
        rows.map((row) => row.elapsedMs),
        95,
      ),
    },
  };
}
