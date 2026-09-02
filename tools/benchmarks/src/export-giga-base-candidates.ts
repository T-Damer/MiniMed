import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore, requestedSectionType } from '@localmed/core';
import { normalizeSurfaceText } from '@localmed/search-lexical';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface QueryFixture {
  readonly id: string;
  readonly query: string;
}

function parseQueries(value: unknown, source: string): readonly QueryFixture[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must contain a non-empty query array.`);
  }
  return value.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !('query' in item) ||
      typeof item.query !== 'string'
    ) {
      throw new Error(`${source} contains an invalid query fixture.`);
    }
    return { id: item.id, query: item.query };
  });
}

function isMetaSection(sectionPath: readonly string[]): boolean {
  const leaf = normalizeSurfaceText(sectionPath.at(-1) ?? '');
  return leaf === 'ограничения' || leaf === 'источник и ограничения';
}

const root = resolve(import.meta.dirname, '../../..');
const queryPaths = [
  'tools/benchmarks/pilot-rf-queries.json',
  'tools/benchmarks/pilot-rf-drug-queries.json',
  'tools/benchmarks/doctor-workflow-queries.json',
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

const rows = [];
for (const fixture of queries) {
  const response = await core.search({
    query: fixture.query,
    mode: 'hybrid',
    filters: {},
    limit: 100,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const preferredSectionType = requestedSectionType(response.value.normalizedQuery);
  const demoteMetaSections = !/ограничен/u.test(response.value.normalizedQuery);

  rows.push({
    fixtureId: fixture.id,
    candidates: response.value.groups
      .flatMap((group) => group.results)
      .toSorted((left, right) => right.finalScore - left.finalScore)
      .map((result) => ({
        chunkId: result.chunkId,
        score: result.finalScore,
        sectionPriority:
          preferredSectionType && result.sectionType === preferredSectionType
            ? 2
            : demoteMetaSections && isMetaSection(result.sectionPath)
              ? 0
              : 1,
      })),
  });
}
await core.close();

const outputPath = resolve(root, 'data/build/giga-base-candidates.json');
mkdirSync(resolve(root, 'data/build'), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      baseMode: 'deterministic-hash-hybrid',
      corpus: initialized.value.contentPackIds[0] ?? 'unknown',
      queryCount: rows.length,
      rows,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`Exported deterministic/hash hybrid candidates for ${rows.length} queries.`);
