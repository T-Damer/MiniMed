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
  readonly category: string;
}

interface RegulatoryRow {
  readonly id: string;
  readonly category: string;
  readonly hitAt1: boolean;
  readonly hitAt5: boolean;
  readonly sectionHit: boolean;
  readonly contextResolved: boolean;
  readonly metadataValid: boolean;
  readonly reciprocalRank: number;
  readonly elapsedMs: number;
  readonly topDocuments: readonly string[];
  readonly matchedAnchor: string | null;
}

function parseQueries(value: unknown): readonly RegulatoryQuery[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Regulatory benchmark must be a non-empty array.');
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

const root = resolve(import.meta.dirname, '../../..');
const queries = parseQueries(
  JSON.parse(readFileSync(resolve(root, 'tools/benchmarks/regulatory-rf-queries.json'), 'utf8')),
);
const databaseBytes = new Uint8Array(readFileSync(resolve(root, 'data/build/rf-regulatory-pilot.db')));
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
  const metadataValid =
    document.versionId === fixture.expectedVersionId &&
    document.status === 'active' &&
    document.sourceType === 'regulatory_act_summary' &&
    document.metadata['authorityTier'] === 'official-regulatory-act' &&
    document.metadata['jurisdiction'] === 'RU' &&
    document.metadata['documentNumber'] === fixture.expectedDocumentNumber &&
    document.metadata['officialPublicationNumber'] === fixture.expectedPublicationNumber &&
    document.metadata['contentMode'] === 'source_linked_paraphrase';

  rows.push({
    id: fixture.id,
    category: fixture.category,
    hitAt1: rank === 1,
    hitAt5: rank !== undefined,
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

const report = {
  generatedAt: new Date().toISOString(),
  corpus: initialized.value.contentPackIds[0] ?? 'unknown',
  queryCount: rows.length,
  recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  sectionRecall: mean(rows.map((row) => Number(row.sectionHit))),
  contextResolutionRate: mean(rows.map((row) => Number(row.contextResolved))),
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
      return [
        category,
        {
          queryCount: categoryRows.length,
          recallAt1: mean(categoryRows.map((row) => Number(row.hitAt1))),
          sectionRecall: mean(categoryRows.map((row) => Number(row.sectionHit))),
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
if (report.recallAt5 < 1) failures.push(`Recall@5 ${report.recallAt5.toFixed(3)} < 1.000`);
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
