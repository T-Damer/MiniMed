/**
 * Golden fixtures for the planned Kotlin (native/) port of the lexical "lookup" search path —
 * stage 1 of the migration recorded in docs/CURRENT_STATE.md ("cross-language runtime migration
 * only after shared golden fixtures proving parity"). This script does not modify search behavior;
 * it runs the *real* production pipeline (ScopedMedicalCore, same as `apps/app`) against the
 * released core.db + companion packs and records exactly what it did, so a later Kotlin port can be
 * checked against these numbers query by query, stage by stage:
 *   - the query plan (branches: id, weight, terms, ftsQuery) — from the real search response's
 *     `diagnostics.branches` (packages/core/src/create-medical-core.ts), not a reimplementation;
 *   - matched aliases and terms — same `diagnostics` object;
 *   - each branch's own raw FTS5 hits (chunk id + bm25 rank), top-N — obtained by re-running that
 *     branch's *exact* `ftsQuery` directly against the store (`MedicalStore.search`), the same call
 *     `create-medical-core.ts` makes internally (see its `runBranchSearches`); this script does not
 *     reimplement branch execution, it reuses the real one twice (once inside the normal search
 *     call for the final groups, once directly per branch for hit-level detail);
 *   - the final top-20 groups (documentId, resolved targetDocumentId, kind, rounded bestScore).
 *
 * Run: bun tools/benchmarks/src/export-search-golden.ts [--corpus=core|all] [--core=path/to/core.db]
 * `--corpus=core` (the default) mounts core.db alone — the native/ spike and the emulator
 * measurements only ever open core.db, so parity must be checked against the same data, not the
 * app's full multi-pack corpus. `--corpus=all` mounts core.db + every companion pack (mkb,
 * medications, ambulatory, regulatory, reference), same as `run-real-corpus.ts --corpus=all` and
 * the real app; writes to a separate `search-golden.all.json` so it never silently overwrites the
 * core-only file `native/shared` actually consumes.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeSurfaceText } from '@localmed/search-lexical';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const HITS_PER_BRANCH = 10;
const GROUP_LIMIT = 20;
const MAX_QUERIES = 150;

// ---------------------------------------------------------------------------------------------
// Query set: already-committed fixture files only, no real clinician/patient query text (AGENTS.md
// "Data-agent rules" / never log clinical query text applies just as much to a checked-in fixture
// as to a runtime log). Concatenated in this fixed priority order, deduplicated by normalized
// text, then capped at MAX_QUERIES.
// ---------------------------------------------------------------------------------------------
interface QuerySource {
  readonly sourceId: string;
  readonly query: string;
}

function readQueryFile(file: string, sourceId: string): QuerySource[] {
  const raw = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks', file), 'utf8'));
  const list: readonly { readonly id?: string; readonly query?: string }[] = Array.isArray(raw)
    ? raw
    : (raw.queries ?? raw.cases ?? []);
  return list
    .filter((entry) => typeof entry.query === 'string' && entry.query.trim().length > 0)
    .map((entry, index) => ({
      sourceId: entry.id ? `${sourceId}.${entry.id}` : `${sourceId}.${index}`,
      query: entry.query as string,
    }));
}

const ourBenchQueries: QuerySource[] = [
  {
    sourceId: 'bench10.meningitis-or-encephalitis-child',
    query: 'Менингит или энцефалит у ребёнка',
  },
  { sourceId: 'bench10.meningitis-child', query: 'менингит у ребенка' },
  { sourceId: 'bench10.tick-encephalitis-child', query: 'клещевой энцефалит у ребенка' },
  {
    sourceId: 'bench10.bronchitis-or-pneumonia-child',
    query: 'бронхит или пневмония у ребёнка 5 лет',
  },
  { sourceId: 'bench10.tonsillitis-or-pharyngitis-child', query: 'ангина или фарингит у ребенка' },
  { sourceId: 'bench10.gastroenteritis-child', query: 'гастроэнтерит у ребёнка' },
  { sourceId: 'bench10.diarrhea-or-vomiting-child', query: 'понос или рвота у ребенка 2 лет' },
  { sourceId: 'bench10.orvi-or-bronchitis-adult', query: 'ОРВИ или бронхит у взрослого' },
  { sourceId: 'bench10.demo01', query: 'лихорадка кашель тахипноэ' },
  { sourceId: 'bench10.demo05', query: 'аугментин пневмония' },
];

const fileSources: readonly [string, string][] = [
  ['doctor-lookup-queries.json', 'doctor-lookup'],
  ['real-corpus-demo-queries.json', 'real-corpus-demo'],
  ['curated-clinician-queries.json', 'curated-clinician'],
  ['doctor-workflow-queries.json', 'doctor-workflow'],
  ['pilot-rf-queries.json', 'pilot-rf'],
  ['search-quality-v2.json', 'search-quality-v2'],
];

function buildQuerySet(): QuerySource[] {
  const all = [...ourBenchQueries, ...fileSources.flatMap(([file, id]) => readQueryFile(file, id))];
  const seen = new Set<string>();
  const deduped: QuerySource[] = [];
  for (const entry of all) {
    const key = normalizeSurfaceText(entry.query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.slice(0, MAX_QUERIES);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (!/^(?:--corpus=(?:core|all)|--core=.+)$/u.test(arg)) {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  // Default 'core', not 'all': the native/ Kotlin port and the emulator measurements it's checked
  // against only ever open core.db alone, so the golden fixture must match that, not the app's
  // full multi-pack corpus (see the file header). Pass --corpus=all for the companion-pack variant.
  const corpusScope = (args.find((arg) => arg.startsWith('--corpus='))?.slice('--corpus='.length) ??
    'core') as 'core' | 'all';
  const corePathOverride = args.find((arg) => arg.startsWith('--core='))?.slice('--core='.length);
  const { core, store, corpus, target } = await openRealCorpus({
    corePath: corePathOverride,
    companions: corpusScope === 'all',
  });
  const scoped = new ScopedMedicalCore(core, 'all');

  const coreDbPath = resolve(
    REPOSITORY_ROOT,
    corePathOverride ?? 'apps/app/public/content/core.db',
  );
  const coreDbSha256 = createHash('sha256').update(readFileSync(coreDbPath)).digest('hex');
  const commit = execSync('git rev-parse HEAD', { cwd: REPOSITORY_ROOT }).toString().trim();

  const queries = buildQuerySet();
  const rows = [];
  for (const { sourceId, query } of queries) {
    const response = await scoped.search({
      query,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: GROUP_LIMIT,
      includeSuggestions: false,
    });
    if (!response.ok) {
      rows.push({ sourceId, query, error: response.error.message });
      continue;
    }
    const { value } = response;

    // Re-run each branch's own exact ftsQuery directly against the store for hit-level detail
    // (chunk id + bm25 rank) — the same call create-medical-core.ts's runBranchSearches makes,
    // just re-executed here so this script can record it without packages/core exposing it.
    const branchHits = await Promise.all(
      value.diagnostics.branches.map(async (branch) => {
        const hits = await store.search({
          ftsQuery: branch.ftsQuery,
          terms: value.diagnostics.terms,
          filters: {},
          limit: HITS_PER_BRANCH,
        });
        return {
          id: branch.id,
          label: branch.label,
          weight: branch.weight,
          ftsQuery: branch.ftsQuery,
          candidateCount: branch.candidateCount,
          topHits: hits
            .slice(0, HITS_PER_BRANCH)
            .map((hit, index) => ({ chunkId: hit.chunk.id, rank: hit.rank, position: index })),
        };
      }),
    );

    rows.push({
      sourceId,
      query,
      normalizedQuery: value.normalizedQuery,
      aliasMatches: value.diagnostics.aliasMatches,
      terms: value.diagnostics.terms,
      branches: branchHits,
      groups: value.groups.map((group) => ({
        documentId: group.documentId,
        targetDocumentId: target(group.documentId),
        documentKind: group.documentKind ?? null,
        contentKind: group.contentKind ?? null,
        bestScore: Math.round(group.bestScore * 1_000_000) / 1_000_000,
      })),
    });
  }
  await core.close();

  const output = {
    generatedAt: new Date().toISOString(),
    commit,
    coreDbSha256,
    coreDbPath: corePathOverride ?? 'apps/app/public/content/core.db',
    corpus,
    analysisMode: 'lookup' as const,
    groupLimit: GROUP_LIMIT,
    hitsPerBranch: HITS_PER_BRANCH,
    queryCount: rows.length,
    queries: rows,
  };

  // search-golden.json (corpus=core, the default — what native/ and the emulator measurements
  // actually open) vs. search-golden.all.json (corpus=all, companion packs included) — two
  // filenames so the multi-pack variant, if ever generated, can never silently clobber the
  // core-only one the Kotlin port is checked against.
  const fileName = corpusScope === 'all' ? 'search-golden.all.json' : 'search-golden.json';
  const outPath = resolve(REPOSITORY_ROOT, `native/shared/src/commonTest/resources/${fileName}`);
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${rows.length} golden queries to ${outPath}`);
  console.log(`core.db sha256: ${coreDbSha256}`);
  console.log(`commit: ${commit}`);
}

await main();
