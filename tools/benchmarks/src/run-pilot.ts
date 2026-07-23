import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface PilotQuery {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly expectedVersionId: string;
  readonly expectedOfficialId?: string;
  readonly expectedSourceType?: string;
  readonly expectedRegistryRecordId?: string;
  readonly expectedRegistrationNumber?: string;
  readonly expectedContentMode?: string;
  readonly expectedAuthorityTier?: string;
  readonly expectedSectionTypes: readonly string[];
  readonly expectedAnchorPrefixes: readonly string[];
  readonly category: string;
}

interface SectionCandidate {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sectionType: string | null;
  readonly anchor: string;
}

interface SourceDocument {
  readonly versionId: string;
  readonly sourceType: string;
  readonly status: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface PilotRow {
  readonly id: string;
  readonly query: string;
  readonly category: string;
  readonly hitAt1: boolean;
  readonly hitAt5: boolean;
  readonly sectionHit: boolean;
  readonly topSectionHit: boolean;
  readonly contextResolved: boolean;
  readonly sourceMetadataValid: boolean;
  readonly reciprocalRank: number;
  readonly elapsedMs: number;
  readonly topDocuments: readonly string[];
  readonly topSectionType: string | null;
  readonly matchedAnchor: string | null;
  readonly candidateCount: number;
  readonly modeUsed: 'lexical' | 'semantic' | 'hybrid';
  readonly semanticStatus: 'disabled' | 'used' | 'fallback';
}

function parseQueries(value: unknown, source: string): readonly PilotQuery[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must contain a non-empty query array.`);
  }
  return value as readonly PilotQuery[];
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
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

function matchesExpectedSection(result: SectionCandidate, fixture: PilotQuery): boolean {
  return (
    fixture.expectedDocumentIds.includes(result.documentId) &&
    result.sectionType !== null &&
    fixture.expectedSectionTypes.includes(result.sectionType) &&
    fixture.expectedAnchorPrefixes.some((prefix) => result.anchor.startsWith(`${prefix}#chunk-`))
  );
}

function matchesOptionalMetadata(actual: unknown, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function matchesExpectedSource(document: SourceDocument, fixture: PilotQuery): boolean {
  const expectedSourceType = fixture.expectedSourceType ?? 'clinical_recommendation_summary';
  const expectedContentMode = fixture.expectedContentMode ?? 'source_linked_paraphrase';
  return (
    document.versionId === fixture.expectedVersionId &&
    document.sourceType === expectedSourceType &&
    document.status === 'active' &&
    document.metadata['contentMode'] === expectedContentMode &&
    document.metadata['publicPilot'] === true &&
    matchesOptionalMetadata(document.metadata['officialId'], fixture.expectedOfficialId) &&
    matchesOptionalMetadata(
      document.metadata['registryRecordId'],
      fixture.expectedRegistryRecordId,
    ) &&
    matchesOptionalMetadata(
      document.metadata['registrationNumber'],
      fixture.expectedRegistrationNumber,
    ) &&
    matchesOptionalMetadata(document.metadata['authorityTier'], fixture.expectedAuthorityTier)
  );
}

const root = resolve(import.meta.dirname, '../../..');
const queryPaths = [
  'tools/benchmarks/pilot-rf-queries.json',
  'tools/benchmarks/pilot-rf-drug-queries.json',
] as const;
const queries = queryPaths.flatMap((path) =>
  parseQueries(JSON.parse(readFileSync(resolve(root, path), 'utf8')), path),
);
const queryIds = queries.map((query) => query.id);
if (new Set(queryIds).size !== queryIds.length) {
  throw new Error('Public-pilot benchmark contains duplicate query IDs.');
}

const databaseBytes = new Uint8Array(readFileSync(resolve(root, 'data/build/rf-public-pilot.db')));
const store = await SqliteMedicalStore.createFromBytes(databaseBytes);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows: PilotRow[] = [];
for (const fixture of queries) {
  const response = await core.search({
    query: fixture.query,
    mode: 'hybrid',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);

  const topDocuments = response.value.groups.map((group) => group.documentId).slice(0, 5);
  const rankIndex = topDocuments.findIndex((id) => fixture.expectedDocumentIds.includes(id));
  const rank = rankIndex >= 0 ? rankIndex + 1 : undefined;
  const expectedGroup = response.value.groups.find((group) =>
    fixture.expectedDocumentIds.includes(group.documentId),
  );
  const bestExpectedResult = expectedGroup?.results[0] ?? null;
  const matchedResult = expectedGroup?.results.find((result) =>
    matchesExpectedSection(result, fixture),
  );

  let contextResolved = false;
  if (matchedResult) {
    const context = await core.getContext(matchedResult.chunkId, 0);
    if (!context.ok) throw new Error(`${fixture.id}: ${context.error.message}`);
    const focusChunk = context.value.chunks.find(
      (chunk) => chunk.id === context.value.focusChunkId,
    );
    contextResolved =
      fixture.expectedAnchorPrefixes.includes(context.value.section.anchor) &&
      focusChunk?.anchor === matchedResult.anchor;
  }

  const documentResult = await core.getDocument(fixture.expectedDocumentIds[0] ?? '');
  if (!documentResult.ok) throw new Error(`${fixture.id}: ${documentResult.error.message}`);
  const sourceMetadataValid = matchesExpectedSource(documentResult.value, fixture);

  rows.push({
    id: fixture.id,
    query: fixture.query,
    category: fixture.category,
    hitAt1: rank === 1,
    hitAt5: rank !== undefined,
    sectionHit: matchedResult !== undefined,
    topSectionHit:
      bestExpectedResult !== null && matchesExpectedSection(bestExpectedResult, fixture),
    contextResolved,
    sourceMetadataValid,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    elapsedMs: response.value.elapsedMs,
    topDocuments,
    topSectionType: bestExpectedResult?.sectionType ?? null,
    matchedAnchor: matchedResult?.anchor ?? null,
    candidateCount: response.value.diagnostics.candidateCount,
    modeUsed: response.value.modeUsed,
    semanticStatus: response.value.diagnostics.semantic.status,
  });
}
await core.close();

const latencies = rows.map((row) => row.elapsedMs);
const categories = Object.fromEntries(
  [...new Set(rows.map((row) => row.category))].toSorted().map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    return [
      category,
      {
        queryCount: categoryRows.length,
        recallAt1: mean(categoryRows.map((row) => Number(row.hitAt1))),
        recallAt5: mean(categoryRows.map((row) => Number(row.hitAt5))),
        mrrAt5: mean(categoryRows.map((row) => row.reciprocalRank)),
        sectionRecall: mean(categoryRows.map((row) => Number(row.sectionHit))),
        topSectionAccuracy: mean(categoryRows.map((row) => Number(row.topSectionHit))),
        contextResolutionRate: mean(categoryRows.map((row) => Number(row.contextResolved))),
        sourceMetadataRate: mean(categoryRows.map((row) => Number(row.sourceMetadataValid))),
      },
    ];
  }),
);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: initialized.value.contentPackIds[0] ?? 'unknown',
  queryCount: rows.length,
  recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  sectionRecall: mean(rows.map((row) => Number(row.sectionHit))),
  topSectionAccuracy: mean(rows.map((row) => Number(row.topSectionHit))),
  contextResolutionRate: mean(rows.map((row) => Number(row.contextResolved))),
  sourceMetadataRate: mean(rows.map((row) => Number(row.sourceMetadataValid))),
  zeroResultRate: mean(rows.map((row) => Number(row.candidateCount === 0))),
  hybridUsageRate: mean(rows.map((row) => Number(row.modeUsed === 'hybrid'))),
  semanticUsageRate: mean(rows.map((row) => Number(row.semanticStatus === 'used'))),
  latencyMs: {
    min: Math.min(...latencies),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Math.max(...latencies),
  },
  categories,
  rows,
};
mkdirSync(resolve(root, 'data/build'), { recursive: true });
writeFileSync(
  resolve(root, 'data/build/rf-public-pilot-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));

const failures: string[] = [];
if (report.recallAt5 < 0.9) failures.push(`Recall@5 ${report.recallAt5.toFixed(3)} < 0.900`);
if (report.mrrAt5 < 0.65) failures.push(`MRR@5 ${report.mrrAt5.toFixed(3)} < 0.650`);
if (report.sectionRecall < 0.9) {
  failures.push(`section recall ${report.sectionRecall.toFixed(3)} < 0.900`);
}
if (report.topSectionAccuracy < 0.7) {
  failures.push(`top-section accuracy ${report.topSectionAccuracy.toFixed(3)} < 0.700`);
}
if (report.contextResolutionRate < 1) {
  failures.push(`context resolution ${report.contextResolutionRate.toFixed(3)} < 1.000`);
}
if (report.sourceMetadataRate < 1) {
  failures.push(`source metadata rate ${report.sourceMetadataRate.toFixed(3)} < 1.000`);
}
if (report.zeroResultRate > 0.1) {
  failures.push(`zero-result rate ${report.zeroResultRate.toFixed(3)} > 0.100`);
}
if (report.hybridUsageRate < 1) {
  failures.push(`hybrid usage rate ${report.hybridUsageRate.toFixed(3)} < 1.000`);
}
if (report.semanticUsageRate < 1) {
  failures.push(`semantic usage rate ${report.semanticUsageRate.toFixed(3)} < 1.000`);
}
if (failures.length > 0) {
  console.error(`Public-pilot benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
process.exit(0);
