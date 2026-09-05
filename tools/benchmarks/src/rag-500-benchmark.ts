/**
 * THROWAWAY benchmark for the local E5 retrieval prototype. It uses only synthetic personal data,
 * never reads the real patient vault, and writes its report under ignored data/build.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type BenchmarkCase,
  type Candidate,
  type Category,
  type CoreDocument,
  createCases,
  type Kind,
  normalize,
  syntheticPersonal,
  tokens,
} from './rag-benchmark-fixtures';
import { cosine, ftsQuery, quantize, WasmEmbedder } from './rag-prototype';

const ROOT = resolve(import.meta.dirname, '../../..');
const INDEX_PATH = resolve(ROOT, 'data/build/rag-prototype-500.sqlite');
const CORE_PATH = resolve(ROOT, 'apps/app/public/content/core.db');
const AMBULATORY_PATH = resolve(ROOT, 'apps/app/public/content/ambulatory.db');
const REPORT_PATH = resolve(ROOT, 'data/build/rag-500-report.json');
const RESULT_LIMIT = 20;
const CANDIDATE_LIMIT = 100;
const RRF_K = 60;
const E5_WEIGHT_ENV = 'RAG_E5_WEIGHT';
const E5_WEIGHT = Number(process.env[E5_WEIGHT_ENV] ?? '1');
if (!Number.isFinite(E5_WEIGHT) || E5_WEIGHT < 0) {
  throw new Error('RAG_E5_WEIGHT must be a non-negative number.');
}

type SqlValue = string | number | bigint | null | Uint8Array;

interface SqlStatement {
  all(...parameters: SqlValue[]): readonly unknown[];
  get(...parameters: SqlValue[]): unknown;
}

interface SqlDatabase {
  query(sql: string): SqlStatement;
  close(): void;
}

interface BunSqliteModule {
  readonly Database: new (path: string, options?: { readonly readonly?: boolean }) => SqlDatabase;
}

interface SearchResult {
  readonly documentId: string;
  readonly title: string;
  readonly kind: Kind;
  readonly score: number;
}

interface EvaluationRow {
  readonly id: string;
  readonly category: Category;
  readonly baselineRank: number | null;
  readonly hybridRank: number | null;
  readonly baselinePassed: boolean;
  readonly hybridPassed: boolean;
  readonly caseClinicalFirst: boolean | null;
  readonly caseDescriptionFound: boolean | null;
  readonly resultCount: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a SQLite object row.');
  }
  return value as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`Expected string column ${key}.`);
  return value;
}

function blobField(row: Record<string, unknown>, key: string): Uint8Array {
  const value = row[key];
  if (!(value instanceof Uint8Array)) throw new TypeError(`Expected blob column ${key}.`);
  return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Expected finite number column ${key}.`);
  }
  return value;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function kindOf(documentId: string, contentPackId: string): Kind {
  if (documentId.startsWith('tool:')) return 'tool';
  if (documentId.startsWith('patient:')) return 'patient';
  if (documentId.startsWith('note:')) return 'personal-note';
  if (documentId.startsWith('core.catalog.pointer.medication.')) return 'medication';
  if (
    documentId.startsWith('core.catalog.pointer.clinical.') ||
    documentId.startsWith('kr.rf.') ||
    contentPackId.includes('clinical')
  ) {
    return 'clinical';
  }
  return 'document';
}

async function sqliteModule(): Promise<BunSqliteModule> {
  return (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;
}

function loadIndexedCandidates(database: SqlDatabase): Candidate[] {
  return database
    .query(
      'SELECT id, document_id, content_pack_id, title, section_path, text, vector, vector_norm FROM rag_chunks',
    )
    .all()
    .map((value) => {
      const row = asRecord(value);
      const documentId = stringField(row, 'document_id');
      const contentPackId = stringField(row, 'content_pack_id');
      return {
        id: stringField(row, 'id'),
        documentId,
        title: stringField(row, 'title'),
        text: stringField(row, 'text'),
        sectionPath: stringField(row, 'section_path'),
        kind: kindOf(documentId, contentPackId),
        vector: blobField(row, 'vector'),
        vectorNorm: numberField(row, 'vector_norm'),
      };
    });
}

function loadCoreDocuments(database: SqlDatabase): CoreDocument[] {
  return database
    .query(`SELECT id, title, metadata_json FROM documents
      WHERE source_type = 'core_catalog_pointer' ORDER BY id`)
    .all()
    .flatMap((value) => {
      const row = asRecord(value);
      const metadata: unknown = JSON.parse(stringField(row, 'metadata_json'));
      if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return [];
      const fields = metadata as Record<string, unknown>;
      const { catalogFamily: family, targetDocumentId, declaredAliases, keywords } = fields;
      if (family !== 'clinical' && family !== 'medication') return [];
      return [
        {
          id: stringField(row, 'id'),
          title: stringField(row, 'title'),
          aliases: strings(declaredAliases),
          keywords: strings(keywords),
          ...(typeof targetDocumentId === 'string' ? { targetDocumentId } : {}),
          family,
        },
      ];
    });
}

function lexicalPersonalScore(query: string, candidate: Candidate): number {
  const queryTokens = [...new Set(tokens(query))];
  const text = new Set(tokens(`${candidate.title} ${candidate.text}`));
  if (queryTokens.length === 0 || !queryTokens.every((token) => text.has(token))) return 0;
  return queryTokens.length + (normalize(candidate.title).includes(normalize(query)) ? 5 : 0);
}

function categoryBoost(category: Category, kind: Kind): number {
  if (category === 'case' && kind === 'clinical') return 0.012;
  if (category === 'medication' && kind === 'medication') return 0.012;
  if (category === 'tool' && kind === 'tool') return 0.012;
  if (category === 'personal-note' && kind === 'personal-note') return 0.012;
  if (category === 'patient' && kind === 'patient') return 0.012;
  return 0;
}

function externalDescriptions(database: SqlDatabase, title: string): SearchResult[] {
  const rows = database
    .query(`SELECT d.id AS document_id, d.title, c.original_text,
      CASE WHEN s.section_type = 'definition' OR s.title LIKE '%Определ%' THEN 0 ELSE 1 END AS section_order,
      bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.chunk_id
      JOIN sections s ON s.id = c.section_id
      JOIN document_versions v ON v.id = c.document_version_id
      JOIN documents d ON d.id = v.document_id AND d.current_version_id = v.id
      WHERE chunks_fts MATCH ?
      ORDER BY section_order, rank LIMIT 5`)
    .all(ftsQuery(title));
  return rows.map((value, index) => {
    const row = asRecord(value);
    return {
      documentId: stringField(row, 'document_id'),
      title: stringField(row, 'title'),
      kind: 'document' as const,
      score: 0.02 - index * 0.001,
    };
  });
}

function search(
  database: SqlDatabase,
  ambulatory: SqlDatabase,
  allCandidates: readonly Candidate[],
  byId: ReadonlyMap<string, Candidate>,
  canonicalDocumentIds: ReadonlyMap<string, string>,
  fixture: BenchmarkCase,
  queryVector: ReturnType<typeof quantize> | undefined,
): SearchResult[] {
  const allowed = (candidate: Candidate): boolean =>
    fixture.personalAllowed !== false || candidate.kind !== 'patient';
  const scores = new Map<string, number>();
  let semanticIds: readonly string[] = [];
  const lexicalIds = database
    .query(
      'SELECT id FROM rag_chunks_fts WHERE rag_chunks_fts MATCH ? ORDER BY bm25(rag_chunks_fts) LIMIT ?',
    )
    .all(ftsQuery(fixture.query), CANDIDATE_LIMIT)
    .map((value) => stringField(asRecord(value), 'id'));
  lexicalIds.forEach((id, rank) => {
    scores.set(id, 1 / (RRF_K + rank + 1));
  });

  const personal = allCandidates
    .filter(
      (candidate) =>
        allowed(candidate) && (candidate.kind === 'personal-note' || candidate.kind === 'patient'),
    )
    .map((candidate) => ({ candidate, score: lexicalPersonalScore(fixture.query, candidate) }))
    .filter((value) => value.score > 0)
    .toSorted((left, right) => right.score - left.score);
  personal.forEach(({ candidate }, rank) => {
    scores.set(candidate.id, 1 / (RRF_K + rank + 1));
  });

  if (queryVector) {
    const semantic = allCandidates
      .filter((candidate) => allowed(candidate) && candidate.vector && candidate.vectorNorm)
      .map((candidate) => ({
        candidate,
        score: cosine(
          queryVector.vector,
          queryVector.norm,
          candidate.vector ?? new Uint8Array(),
          candidate.vectorNorm ?? 0,
        ),
      }))
      .toSorted((left, right) => right.score - left.score)
      .slice(0, CANDIDATE_LIMIT);
    semanticIds = semantic.map(({ candidate }) => candidate.id);
    semantic.forEach(({ candidate }, rank) => {
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + E5_WEIGHT / (RRF_K + rank + 1));
    });
  }

  const exactPhrase = fixture.phrase ? normalize(fixture.query) : undefined;
  const documents = new Map<string, SearchResult>();
  for (const [id, baseScore] of scores) {
    const candidate = byId.get(id);
    if (!candidate || !allowed(candidate)) continue;
    const documentId = canonicalDocumentIds.get(candidate.documentId) ?? candidate.documentId;
    const phraseBoost = exactPhrase && normalize(candidate.text).includes(exactPhrase) ? 1 : 0;
    const titleBoost = normalize(fixture.query).includes(normalize(candidate.title)) ? 1 : 0;
    const score =
      baseScore + categoryBoost(fixture.category, candidate.kind) + phraseBoost + titleBoost;
    const current = documents.get(documentId);
    if (!current || score > current.score) {
      documents.set(documentId, {
        documentId,
        title: candidate.title,
        kind: candidate.kind,
        score,
      });
    }
  }
  let results = [...documents.values()].toSorted((left, right) => right.score - left.score);
  if (queryVector && (fixture.category === 'case' || fixture.category === 'symptom')) {
    const canonicalResults = (candidateIds: readonly string[]): SearchResult[] => {
      const seen = new Set<string>();
      return candidateIds.flatMap((candidateId) => {
        const candidate = byId.get(candidateId);
        if (!candidate) return [];
        const documentId = canonicalDocumentIds.get(candidate.documentId) ?? candidate.documentId;
        if (seen.has(documentId)) return [];
        seen.add(documentId);
        const result = documents.get(documentId);
        return result ? [result] : [];
      });
    };
    const lexicalLeading = canonicalResults(lexicalIds).slice(
      0,
      fixture.category === 'symptom' ? 2 : 3,
    );
    const leadingIds = new Set(lexicalLeading.map((result) => result.documentId));
    const semanticLeading = canonicalResults(semanticIds)
      .filter((result) => !leadingIds.has(result.documentId))
      .slice(0, 4 - lexicalLeading.length);
    const preferred = [...lexicalLeading, ...semanticLeading];
    const preferredIds = new Set(preferred.map((result) => result.documentId));
    results = [...preferred, ...results.filter((result) => !preferredIds.has(result.documentId))];
  }
  if (fixture.category === 'case') {
    const clinical = results.filter((result) => result.kind === 'clinical').slice(0, 2);
    if (clinical.length > 0) {
      const leading = clinical.flatMap((candidate) => [
        candidate,
        ...externalDescriptions(ambulatory, candidate.title)
          .filter((description) => !documents.has(description.documentId))
          .slice(0, 1),
      ]);
      const leadingIds = new Set(leading.map((result) => result.documentId));
      results = [...leading, ...results.filter((result) => !leadingIds.has(result.documentId))];
    }
  }
  return results.slice(0, RESULT_LIMIT);
}

function rankOf(fixture: BenchmarkCase, results: readonly SearchResult[]): number | null {
  const index = results.findIndex((result) =>
    fixture.expectedDocumentIds.includes(result.documentId),
  );
  return index < 0 ? null : index + 1;
}

function passed(
  fixture: BenchmarkCase,
  results: readonly SearchResult[],
  rank: number | null,
): boolean {
  if (fixture.expectNoPatient) return results.every((result) => result.kind !== 'patient');
  return rank !== null && rank <= RESULT_LIMIT;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(rows: readonly EvaluationRow[], mode: 'baseline' | 'hybrid') {
  const rankKey = mode === 'baseline' ? 'baselineRank' : 'hybridRank';
  const passKey = mode === 'baseline' ? 'baselinePassed' : 'hybridPassed';
  const recalledAt = (row: EvaluationRow, cutoff: number): boolean =>
    (row[rankKey] ?? Infinity) <= cutoff || (row[passKey] && row[rankKey] === null);
  return {
    count: rows.length,
    recallAt1: mean(
      rows.map((row) => Number(row[rankKey] === 1 || (row[passKey] && row[rankKey] === null))),
    ),
    recallAt4: mean(rows.map((row) => Number(recalledAt(row, 4)))),
    recallAt5: mean(rows.map((row) => Number(recalledAt(row, 5)))),
    recallAt20: mean(rows.map((row) => Number(row[passKey]))),
    mrrAt20: mean(rows.map((row) => (row[rankKey] ? 1 / row[rankKey] : Number(row[passKey])))),
  };
}

async function embedPersonal(
  embedder: WasmEmbedder,
  candidates: Candidate[],
): Promise<Candidate[]> {
  const output: Candidate[] = [];
  for (let offset = 0; offset < candidates.length; offset += 16) {
    const batch = candidates.slice(offset, offset + 16);
    const vectors = await embedder.embed(
      batch.map((candidate) => `passage: ${candidate.title}\n${candidate.text}`),
    );
    batch.forEach((candidate, index) => {
      const vector = vectors[index];
      if (!vector) throw new Error('Synthetic personal embedding batch mismatch.');
      const quantized = quantize(vector);
      output.push({ ...candidate, vector: quantized.vector, vectorNorm: quantized.norm });
    });
  }
  return output;
}

async function main(): Promise<void> {
  if (!existsSync(INDEX_PATH))
    throw new Error(`Build the 500-case prototype index first: ${INDEX_PATH}`);
  const sqlite = await sqliteModule();
  const index = new sqlite.Database(INDEX_PATH, { readonly: true });
  const coreDatabase = new sqlite.Database(CORE_PATH, { readonly: true });
  const ambulatory = new sqlite.Database(AMBULATORY_PATH, { readonly: true });
  const embedder = await WasmEmbedder.create(true);
  try {
    const indexed = loadIndexedCandidates(index);
    const personal = syntheticPersonal();
    const embeddedPersonal = await embedPersonal(embedder, personal.candidates);
    const candidates = [...indexed, ...embeddedPersonal];
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const coreDocuments = loadCoreDocuments(coreDatabase);
    const installedDocumentIds = new Set(indexed.map((candidate) => candidate.documentId));
    const canonicalDocumentIds = new Map<string, string>();
    for (const documentId of installedDocumentIds) {
      if (!documentId.endsWith('.full')) continue;
      const summaryDocumentId = documentId.slice(0, -'.full'.length);
      if (installedDocumentIds.has(summaryDocumentId)) {
        canonicalDocumentIds.set(summaryDocumentId, documentId);
      }
    }
    for (const document of coreDocuments) {
      const targetDocumentId = document.targetDocumentId;
      if (!targetDocumentId || !installedDocumentIds.has(targetDocumentId)) continue;
      canonicalDocumentIds.set(
        document.id,
        canonicalDocumentIds.get(targetDocumentId) ?? targetDocumentId,
      );
    }
    const fixtures = createCases(coreDocuments, candidates);

    const queryVectors: ReturnType<typeof quantize>[] = [];
    const embeddingStartedAt = performance.now();
    for (let offset = 0; offset < fixtures.length; offset += 16) {
      const batch = fixtures.slice(offset, offset + 16);
      const vectors = await embedder.embed(batch.map((fixture) => `query: ${fixture.query}`));
      queryVectors.push(...vectors.map(quantize));
    }
    const queryEmbeddingMs = performance.now() - embeddingStartedAt;

    const rows: EvaluationRow[] = [];
    const searchStartedAt = performance.now();
    fixtures.forEach((fixture, indexValue) => {
      const baseline = search(
        index,
        ambulatory,
        candidates,
        byId,
        canonicalDocumentIds,
        fixture,
        undefined,
      );
      const hybrid = search(
        index,
        ambulatory,
        candidates,
        byId,
        canonicalDocumentIds,
        fixture,
        queryVectors[indexValue],
      );
      const baselineRank = rankOf(fixture, baseline);
      const hybridRank = rankOf(fixture, hybrid);
      rows.push({
        id: fixture.id,
        category: fixture.category,
        baselineRank,
        hybridRank,
        baselinePassed: passed(fixture, baseline, baselineRank),
        hybridPassed: passed(fixture, hybrid, hybridRank),
        caseClinicalFirst: fixture.category === 'case' ? hybrid[0]?.kind === 'clinical' : null,
        caseDescriptionFound:
          fixture.category === 'case'
            ? hybrid.slice(1).some((result) => result.kind === 'document')
            : null,
        resultCount: hybrid.length,
      });
    });
    const searchMs = performance.now() - searchStartedAt;
    const categories = Object.fromEntries(
      [...new Set(rows.map((row) => row.category))].toSorted().map((category) => {
        const categoryRows = rows.filter((row) => row.category === category);
        return [
          category,
          {
            baseline: summarize(categoryRows, 'baseline'),
            hybrid: summarize(categoryRows, 'hybrid'),
          },
        ];
      }),
    );
    const caseRows = rows.filter((row) => row.category === 'case');
    const phraseRows = rows.filter((row) => row.id.startsWith('document-phrase-'));
    const report = {
      generatedAt: new Date().toISOString(),
      model: 'Xenova/multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      e5Weight: E5_WEIGHT,
      fixtureCount: rows.length,
      indexedCandidateCount: indexed.length,
      syntheticPersonalCandidateCount: embeddedPersonal.length,
      resultLimit: RESULT_LIMIT,
      baseline: summarize(rows, 'baseline'),
      hybrid: summarize(rows, 'hybrid'),
      categories,
      casePolicy: {
        clinicalRecommendationFirstRate: mean(caseRows.map((row) => Number(row.caseClinicalFirst))),
        descriptionFollowupRate: mean(caseRows.map((row) => Number(row.caseDescriptionFound))),
      },
      phraseExactDocumentRecallAt4: summarize(phraseRows, 'hybrid').recallAt4,
      phraseExactDocumentRecallAt20: summarize(phraseRows, 'hybrid').recallAt20,
      patientLockedLeakCount: rows.filter(
        (row) => row.id.startsWith('patient-locked-') && !row.hybridPassed,
      ).length,
      latencyMs: {
        queryEmbeddingTotal: queryEmbeddingMs,
        queryEmbeddingMean: queryEmbeddingMs / fixtures.length,
        baselineAndHybridSearchTotal: searchMs,
        baselineAndHybridSearchMean: searchMs / fixtures.length,
      },
      rankingChanges: {
        improved: rows.filter(
          (row) =>
            row.baselineRank !== null &&
            row.hybridRank !== null &&
            row.hybridRank < row.baselineRank,
        ).length,
        worsened: rows.filter(
          (row) =>
            row.baselineRank !== null &&
            row.hybridRank !== null &&
            row.hybridRank > row.baselineRank,
        ).length,
      },
      regressions: rows
        .filter((row) => row.baselinePassed && !row.hybridPassed)
        .map((row) => row.id),
      top4Regressions: rows
        .filter((row) => (row.baselineRank ?? Infinity) <= 4 && (row.hybridRank ?? Infinity) > 4)
        .map((row) => row.id),
      top4Misses: rows
        .filter(
          (row) =>
            (row.hybridRank ?? Infinity) > 4 && !(row.hybridPassed && row.hybridRank === null),
        )
        .map((row) => row.id),
      failures: rows.filter((row) => !row.hybridPassed).map((row) => row.id),
      rows,
    };
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
  } finally {
    await embedder.close();
    ambulatory.close();
    coreDatabase.close();
    index.close();
  }
}

await main();
