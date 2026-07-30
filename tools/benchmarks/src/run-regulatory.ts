import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface RegulatoryQuery {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentId: string;
  readonly expectedVersionId: string;
  readonly expectedDocumentNumber: string;
  readonly expectedPublicationNumber: string;
  readonly expectedSectionType: string;
  readonly expectedAnchorPrefix: string;
  readonly expectedStatus?: 'active' | 'superseded';
  readonly expectedSupersededBy?: string;
  readonly expectedAgeGroups?: readonly string[];
  readonly expectedAudienceLabel?: string;
  readonly requireTop1?: boolean;
  readonly requireSection?: boolean;
  readonly category: string;
}

interface RegulatoryRow {
  readonly id: string;
  readonly category: string;
  readonly rank: number | null;
  readonly hitAt1: boolean;
  readonly hitAt2: boolean;
  readonly hitAt5: boolean;
  readonly requiredRankPassed: boolean;
  readonly sectionRequired: boolean;
  readonly sectionHit: boolean;
  readonly contextResolved: boolean;
  readonly metadataValid: boolean;
  readonly reciprocalRank: number;
  readonly elapsedMs: number;
  readonly topDocuments: readonly string[];
  readonly matchedAnchor: string | null;
}

function parseQueries(value: unknown, source: string): readonly RegulatoryQuery[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must contain a non-empty regulatory query array.`);
  }
  return value as readonly RegulatoryQuery[];
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

function metadataStrings(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

const root = resolve(import.meta.dirname, '../../..');
const queryPaths = [
  'tools/benchmarks/regulatory-rf-queries.json',
  'tools/benchmarks/regulatory-rf-major-queries.json',
] as const;
const queries = queryPaths.flatMap((path) =>
  parseQueries(JSON.parse(readFileSync(resolve(root, path), 'utf8')), path),
);
const queryIds = queries.map((query) => query.id);
if (new Set(queryIds).size !== queryIds.length) {
  throw new Error('Regulatory benchmark contains duplicate query IDs.');
}

const databaseBytes = new Uint8Array(
  readFileSync(resolve(root, 'data/build/rf-regulatory-pilot.db')),
);
const store = await SqliteMedicalStore.createFromBytes(databaseBytes);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows: RegulatoryRow[] = [];
for (const fixture of queries) {
  const response = await core.search({
    query: fixture.query,
    mode: 'hybrid',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);

  const topDocuments = response.value.groups.map((group) => group.documentId).slice(0, 5);
  const rankIndex = topDocuments.indexOf(fixture.expectedDocumentId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : undefined;
  const expectedGroup = response.value.groups.find(
    (group) => group.documentId === fixture.expectedDocumentId,
  );
  const matched = expectedGroup?.results.find(
    (result) =>
      result.sectionType === fixture.expectedSectionType &&
      result.anchor.startsWith(`${fixture.expectedAnchorPrefix}#chunk-`),
  );

  let contextResolved = false;
  if (matched) {
    const context = await core.getContext(matched.chunkId, 0);
    if (!context.ok) throw new Error(`${fixture.id}: ${context.error.message}`);
    const focus = context.value.chunks.find((chunk) => chunk.id === context.value.focusChunkId);
    contextResolved =
      context.value.section.anchor === fixture.expectedAnchorPrefix && focus?.anchor === matched.anchor;
  }

  const documentResult = await core.getDocument(fixture.expectedDocumentId);
  if (!documentResult.ok) throw new Error(`${fixture.id}: ${documentResult.error.message}`);
  const document = documentResult.value;
  const metadata = document.metadata;
  const expectedStatus = fixture.expectedStatus ?? 'active';
  const actualAgeGroups = metadataStrings(metadata, 'ageGroups');
  const ageGroupsValid =
    fixture.expectedAgeGroups === undefined ||
    fixture.expectedAgeGroups.every((ageGroup) => actualAgeGroups.includes(ageGroup));
  const audienceLabelValid =
    fixture.expectedAudienceLabel === undefined ||
    metadata['audienceLabel'] === fixture.expectedAudienceLabel;
  const metadataValid =
    document.versionId === fixture.expectedVersionId &&
    document.status === expectedStatus &&
    document.sourceType === 'regulatory_act_summary' &&
    metadata['authorityTier'] === 'official-regulatory-act' &&
    metadata['jurisdiction'] === 'RU' &&
    metadata['documentNumber'] === fixture.expectedDocumentNumber &&
    metadata['officialPublicationNumber'] === fixture.expectedPublicationNumber &&
    metadata['contentMode'] === 'source_linked_paraphrase' &&
    ageGroupsValid &&
    audienceLabelValid &&
    (fixture.expectedSupersededBy === undefined ||
      metadata['supersededByDocumentId'] === fixture.expectedSupersededBy);

  const requiredRank = fixture.requireTop1 === true ? 1 : 2;
  rows.push({
    id: fixture.id,
    category: fixture.category,
    rank: rank ?? null,
    hitAt1: rank === 1,
    hitAt2: rank !== undefined && rank <= 2,
    hitAt5: rank !== undefined,
    requiredRankPassed: rank !== undefined && rank <= requiredRank,
    sectionRequired: fixture.requireSection !== false,
    sectionHit: matched !== undefined,
    contextResolved,
    metadataValid,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    elapsedMs: response.value.elapsedMs,
    topDocuments,
    matchedAnchor: matched?.anchor ?? null,
  });
}
await core.close();

const sectionRows = rows.filter((row) => row.sectionRequired);
const top1Rows = rows.filter((row) => queries.find((query) => query.id === row.id)?.requireTop1);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: initialized.value.contentPackIds[0] ?? 'unknown',
  queryCount: rows.length,
  recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
  recallAt2: mean(rows.map((row) => Number(row.hitAt2))),
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  requiredRankRate: mean(rows.map((row) => Number(row.requiredRankPassed))),
  requiredTop1Rate: mean(top1Rows.map((row) => Number(row.hitAt1))),
  sectionRecall: mean(sectionRows.map((row) => Number(row.sectionHit))),
  contextResolutionRate: mean(sectionRows.map((row) => Number(row.contextResolved))),
  metadataRate: mean(rows.map((row) => Number(row.metadataValid))),
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
  categories: Object.fromEntries(
    [...new Set(rows.map((row) => row.category))].toSorted().map((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      const categorySectionRows = categoryRows.filter((row) => row.sectionRequired);
      return [
        category,
        {
          queryCount: categoryRows.length,
          recallAt1: mean(categoryRows.map((row) => Number(row.hitAt1))),
          recallAt2: mean(categoryRows.map((row) => Number(row.hitAt2))),
          requiredRankRate: mean(categoryRows.map((row) => Number(row.requiredRankPassed))),
          sectionRecall: mean(categorySectionRows.map((row) => Number(row.sectionHit))),
        },
      ];
    }),
  ),
  rows,
};

mkdirSync(resolve(root, 'data/build'), { recursive: true });
writeFileSync(
  resolve(root, 'data/build/rf-regulatory-pilot-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));

const failures: string[] = [];
if (report.recallAt1 < 0.85) failures.push(`Recall@1 ${report.recallAt1.toFixed(3)} < 0.850`);
if (report.recallAt2 < 1) failures.push(`Recall@2 ${report.recallAt2.toFixed(3)} < 1.000`);
if (report.recallAt5 < 1) failures.push(`Recall@5 ${report.recallAt5.toFixed(3)} < 1.000`);
if (report.requiredRankRate < 1) {
  failures.push(`required rank rate ${report.requiredRankRate.toFixed(3)} < 1.000`);
}
if (top1Rows.length > 0 && report.requiredTop1Rate < 1) {
  failures.push(`required top-1 rate ${report.requiredTop1Rate.toFixed(3)} < 1.000`);
}
if (report.sectionRecall < 0.9) {
  failures.push(`section recall ${report.sectionRecall.toFixed(3)} < 0.900`);
}
if (report.contextResolutionRate < 1) {
  failures.push(`context resolution ${report.contextResolutionRate.toFixed(3)} < 1.000`);
}
if (report.metadataRate < 1) {
  failures.push(`metadata validation ${report.metadataRate.toFixed(3)} < 1.000`);
}
if (failures.length > 0) {
  console.error(`Regulatory benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
