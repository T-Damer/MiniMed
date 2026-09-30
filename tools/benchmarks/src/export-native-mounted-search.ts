/** Actual production scoped retrieval over the exact core and immutable installed regulatory pack. */
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ScopedMedicalCore,
  type SearchScope,
} from '@localmed/app/features/search/ScopedMedicalCore';
import { findObservedBranch, observeStoreSearch } from '@localmed/benchmarks/observe-store-search';
import { openRealCorpus, REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import type { SearchFilters } from '@localmed/contracts';

const moduleId = 'minimed.regulatory.pediatrics.ru';
const moduleVersion = '0.3.4-preview.1';
const moduleSha256 = '61b82c9cc8a6899b24e7b6208642a35ef1a448e15c08990df3c79c7b911ca040';
const coreSha256 = '13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f';
const args = process.argv.slice(2);
const argument = (name: string, fallback: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const corePath = resolve(REPOSITORY_ROOT, argument('core', 'apps/app/public/content/core.db'));
const modulePath = resolve(
  REPOSITORY_ROOT,
  argument('module', 'playwright/native-verified-regulatory.db'),
);
async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
if ((await checksum(corePath)) !== coreSha256 || (await checksum(modulePath)) !== moduleSha256)
  throw new Error('Mounted oracle requires the exact qualified immutable artifacts');

const source: { queries: readonly { query: string; groups: readonly { documentId: string }[] }[] } =
  JSON.parse(
    readFileSync(
      resolve(REPOSITORY_ROOT, 'native/shared/src/commonTest/resources/clinical-golden.json'),
      'utf8',
    ),
  );
const clinical = source.queries[0];
if (!clinical?.query || !clinical.groups[0])
  throw new Error('Missing public clinical regression case');
interface Case {
  readonly sourceId: string;
  readonly query: string;
  readonly scope: SearchScope;
  readonly analysisMode: 'lookup' | 'clinical';
  readonly filters: SearchFilters;
}
const scopes: readonly SearchScope[] = [
  'all',
  'diagnosis',
  'guidelines',
  'medications',
  'legal',
  'personal',
  'conditions',
  'calculators',
  'assessments',
];
const modes = ['lookup', 'clinical'] as const;
const lawId = 'regulatory.rf.minzdrav.192n-2025';
const cases: Case[] = scopes.flatMap((scope) =>
  modes.map((analysisMode) => ({
    sourceId: `scope.${scope}.${analysisMode}`,
    query: scope === 'legal' ? '192н' : scope === 'medications' ? 'амоксициллин' : 'пневмония',
    scope,
    analysisMode,
    filters: {},
  })),
);
cases.push(
  {
    sourceId: 'all.installed-law',
    query: '192н',
    scope: 'all',
    analysisMode: 'lookup',
    filters: {},
  },
  {
    sourceId: 'legal.second-document',
    query: '211н',
    scope: 'legal',
    analysisMode: 'lookup',
    filters: {},
  },
  {
    sourceId: 'legal.historical-document',
    query: '302н',
    scope: 'legal',
    analysisMode: 'lookup',
    filters: {},
  },
  { sourceId: 'all.icd-code', query: 'J18.9', scope: 'all', analysisMode: 'lookup', filters: {} },
  {
    sourceId: 'all.clinical-regression',
    query: clinical.query,
    scope: 'all',
    analysisMode: 'clinical',
    filters: {},
  },
);
const filtered: readonly [string, SearchScope, string, SearchFilters][] = [
  ['document.installed', 'all', '192н', { documentIds: [lawId] }],
  ['document.core', 'all', clinical.query, { documentIds: [clinical.groups[0].documentId] }],
  [
    'document.scope-intersection',
    'legal',
    'пневмония',
    { documentIds: [clinical.groups[0].documentId] },
  ],
  ['document.empty-array', 'legal', '192н', { documentIds: [] }],
  ['document.absent', 'all', 'АО', { documentIds: ['__native_absent_document__'] }],
  ['specialty.present', 'legal', '192н', { specialties: ['pediatrics'] }],
  ['specialty.absent', 'legal', '192н', { specialties: ['__native_absent_specialty__'] }],
  ['age.present', 'legal', '192н', { ageGroups: ['children'] }],
  ['age.excluded', 'legal', '192н', { ageGroups: ['adults'] }],
  ['section.present', 'all', 'пневмония диагностика', { sectionTypes: ['diagnostics'] }],
  ['section.absent', 'all', 'АО', { sectionTypes: ['__native_absent_section__'] }],
  [
    'combined.present',
    'legal',
    '192н',
    {
      documentIds: [lawId],
      specialties: ['pediatrics'],
      ageGroups: ['children'],
      sectionTypes: ['definition', 'other'],
    },
  ],
];
for (const [id, scope, query, filters] of filtered)
  for (const analysisMode of modes)
    cases.push({ sourceId: `filter.${id}.${analysisMode}`, query, scope, filters, analysisMode });

const versions = new Map<
  string,
  {
    documentId: string;
    documentVersionId: string;
    sourceChecksum: string;
    moduleId: string | null;
    moduleVersion: string | null;
  }
>();
// Same Bun runtime boundary as bun-sqlite-medical-store; benchmark builds otherwise use Node types.
const { Database } = (await import('bun:sqlite' as string)) as {
  Database: new (
    path: string,
    options: { readonly: true },
  ) => {
    query(sql: string): { all(): readonly unknown[] };
    close(): void;
  };
};
for (const [path, mounted] of [
  [corePath, false],
  [modulePath, true],
] as const) {
  const database = new Database(path, { readonly: true });
  try {
    for (const value of database
      .query('SELECT id, document_id, source_checksum FROM document_versions')
      .all()) {
      if (typeof value !== 'object' || value === null)
        throw new Error('Invalid oracle source version');
      const row = value as Record<string, unknown>;
      if (
        typeof row['id'] !== 'string' ||
        typeof row['document_id'] !== 'string' ||
        typeof row['source_checksum'] !== 'string'
      )
        throw new Error('Invalid oracle source version fields');
      if (versions.has(row['id'])) throw new Error('Oracle source version collision');
      versions.set(row['id'], {
        documentId: row['document_id'],
        documentVersionId: row['id'],
        sourceChecksum: row['source_checksum'],
        moduleId: mounted ? moduleId : null,
        moduleVersion: mounted ? moduleVersion : null,
      });
    }
  } finally {
    database.close();
  }
}
const rows = [];
const requestFilterSets: SearchFilters[] = [];
const filterSetIndexes = new Map<string, number>();
for (const installed of [false, true]) {
  const { core, store, target } = await openRealCorpus({
    corePath,
    companions: false,
    installedModules: installed ? [{ moduleId, path: modulePath }] : [],
  });
  const calls = observeStoreSearch(store);
  try {
    for (const entry of cases) {
      calls.length = 0;
      const response = await new ScopedMedicalCore(core, entry.scope).search({
        query: entry.query,
        mode: 'lexical',
        analysisMode: entry.analysisMode,
        filters: entry.filters,
        limit: 20,
        includeSuggestions: false,
      });
      if (!response.ok)
        throw new Error(
          `Production scoped search failed: ${entry.sourceId}/${response.error.code}`,
        );
      const value = response.value;
      rows.push({
        ...entry,
        installed,
        normalizedQuery: value.normalizedQuery,
        ...(entry.analysisMode === 'clinical' ? { analysis: value.analysis } : {}),
        aliasMatches: value.diagnostics.aliasMatches,
        terms: value.diagnostics.terms,
        branches: value.diagnostics.branches.map((branch) => {
          const call = findObservedBranch(calls, branch.ftsQuery, branch.candidateCount);
          const { filters, ...parameters } = call.request;
          const key = JSON.stringify(filters);
          let filterSetIndex = filterSetIndexes.get(key);
          if (filterSetIndex === undefined) {
            filterSetIndex = requestFilterSets.length;
            filterSetIndexes.set(key, filterSetIndex);
            requestFilterSets.push(filters);
          }
          return {
            id: branch.id,
            label: branch.label,
            weight: branch.weight,
            ftsQuery: branch.ftsQuery,
            candidateCount: branch.candidateCount,
            request: { ...parameters, filterSetIndex },
            topHits: call.hits
              .slice(0, 10)
              .map((hit, position) => ({ chunkId: hit.chunk.id, rank: hit.rank, position })),
          };
        }),
        groups: value.groups.map((group) => ({
          documentId: group.documentId,
          targetDocumentId: target(group.documentId),
          documentKind: group.documentKind ?? null,
          contentKind: group.contentKind ?? null,
          bestScore: Math.round(group.bestScore * 1e6) / 1e6,
          results: group.results.map((result) => {
            const version = versions.get(result.documentVersionId);
            if (!version || version.documentId !== result.documentId)
              throw new Error('Production result has no exact source version');
            return {
              chunkId: result.chunkId,
              documentVersionId: result.documentVersionId,
              sectionId: result.sectionId,
              anchor: result.anchor,
              sourceTarget: { ...version, anchor: result.anchor },
              snippet: result.snippet,
              highlightedRanges: result.highlightedRanges,
              matchedTerms: result.matchedTerms,
              finalScore: Math.round(result.finalScore * 1e6) / 1e6,
            };
          }),
        })),
      });
    }
  } finally {
    await core.close();
  }
}
const output = resolve(
  REPOSITORY_ROOT,
  argument('output', 'native/shared/src/commonTest/resources/mounted-search-golden.json'),
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), coreDbSha256: coreSha256, module: { id: moduleId, version: moduleVersion, sha256: moduleSha256, searchWeight: 1 }, coreSearchWeight: 1.1, groupLimit: 20, requestFilterSets, queryCount: rows.length, queries: rows }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    cases: rows.length,
    groups: rows.reduce((count, row) => count + row.groups.length, 0),
    output,
  }),
);
