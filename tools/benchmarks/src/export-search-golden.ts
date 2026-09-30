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
 *   - each branch's actual store hits (chunk id + rank), top-N — observed during the production
 *     call, including its terms, filters, candidate limit and mode-specific diversification;
 *   - final groups and source passages (targets, scores, chunk/version/section identities, anchors,
 *     query-aligned excerpts and highlight offsets).
 *
 * Run: bun tools/benchmarks/src/export-search-golden.ts [--corpus=core|all] [--analysis-mode=lookup|clinical]
 *      [--core=path/to/core.db]
 *      [--output=playwright/search-golden.json]
 * `--corpus=core` (the default) mounts core.db alone — the native/ spike and the emulator
 * measurements only ever open core.db, so parity must be checked against the same data, not the
 * app's full multi-pack corpus. `--corpus=all` mounts core.db + every companion pack (mkb,
 * medications, ambulatory, regulatory, reference), same as `run-real-corpus.ts --corpus=all` and
 * the real app; writes to a separate `search-golden.all.json` so it never silently overwrites the
 * core-only file `native/shared` actually consumes.
 * `--analysis-mode=clinical` captures the same 85 public regression cases and parsed facts in
 * clinical-golden.json. It records the lexical clinical pipeline; hybrid/semantic qualification
 * remains a separate gate and the qualified lookup fixture is never overwritten.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ScopedMedicalCore } from '@localmed/app/features/search/ScopedMedicalCore';
import { findObservedBranch, observeStoreSearch } from '@localmed/benchmarks/observe-store-search';
import { openRealCorpus, REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { normalizeSurfaceText } from '@localmed/search-lexical';

const HITS_PER_BRANCH = 10;
const GROUP_LIMIT = 20;
// Was 150; bumped to fit the 10 fixed ICD-10-code queries added below (the previous 142 committed
// queries none contained a letter-bearing ICD code, so the icd10LegacyFtsQueries chapter-letter fix
// — commit b516c222 — went unverified by this fixture) without truncating any existing query.
const MAX_QUERIES = 160;

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

// Fixed, non-clinical ICD-10-code-shaped inputs (not real clinician/patient query text — see the
// AGENTS.md rule this file's header cites) added to cover `icd10LegacyFtsQueries`'s letter-derived
// chapter fix (commit b516c222): none of the queries above happen to contain a letter-bearing ICD
// code, so that fix's ftsQuery-text change went unverified by the golden fixture until now. Covers:
// a bare "letter+3 digits" code, the same without the dot, lowercase, a chapter letter the legacy
// hardcoded "i" fallback would have gotten wrong (F, L), a Cyrillic lookalike of a Latin chapter
// letter (Е looks like E), a 3-character-only code, a bare number (no letter — exercises the
// legacy "i" fallback branch, still hit deliberately since it's not dead code), and two more
// chapter/format variants.
const icd10CodeQueries: QuerySource[] = [
  { sourceId: 'icd10.j18-9-dot', query: 'J18.9' },
  { sourceId: 'icd10.j189-no-dot', query: 'J189' },
  { sourceId: 'icd10.j18-9-lower', query: 'j18.9' },
  { sourceId: 'icd10.f23-3', query: 'F23.3' },
  { sourceId: 'icd10.l11-0', query: 'L11.0' },
  { sourceId: 'icd10.e11-9-cyrillic', query: 'Е11.9' },
  { sourceId: 'icd10.i10', query: 'I10' },
  { sourceId: 'icd10.bare-67-9', query: '67.9' },
  { sourceId: 'icd10.e11', query: 'E11' },
  { sourceId: 'icd10.k35-8', query: 'K35.8' },
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
  const all = [
    ...ourBenchQueries,
    ...icd10CodeQueries,
    ...fileSources.flatMap(([file, id]) => readQueryFile(file, id)),
  ];
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

/** Same 85 public cases as run-real-corpus; lexical output isolates the clinical port's stages. */
function buildClinicalQuerySet(): QuerySource[] {
  const demo: {
    queries: readonly { id: string; query: string; status: string }[];
    cases: readonly { id: string; query: string }[];
  } = JSON.parse(
    readFileSync(
      resolve(REPOSITORY_ROOT, 'tools/benchmarks/real-corpus-demo-queries.json'),
      'utf8',
    ),
  );
  return [
    ...readQueryFile('pilot-rf-queries.json', 'pilot-rf'),
    ...readQueryFile('pilot-rf-drug-queries.json', 'pilot-rf-drug'),
    ...readQueryFile('doctor-workflow-queries.json', 'doctor-workflow'),
    ...demo.queries
      .filter((item) => item.status !== 'excluded')
      .map((item) => ({
        sourceId: `real-corpus-demo.${item.id}`,
        query: item.query,
      })),
    ...demo.cases.map((item) => ({ sourceId: `clinical-case.${item.id}`, query: item.query })),
  ];
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (
      !/^(?:--corpus=(?:core|all)|--analysis-mode=(?:lookup|clinical)|--core=.+|--output=.+)$/u.test(
        arg,
      )
    ) {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  // Default 'core', not 'all': the native/ Kotlin port and the emulator measurements it's checked
  // against only ever open core.db alone, so the golden fixture must match that, not the app's
  // full multi-pack corpus (see the file header). Pass --corpus=all for the companion-pack variant.
  const corpusScope = (args.find((arg) => arg.startsWith('--corpus='))?.slice('--corpus='.length) ??
    'core') as 'core' | 'all';
  const corePathOverride = args.find((arg) => arg.startsWith('--core='))?.slice('--core='.length);
  const analysisMode = (args
    .find((arg) => arg.startsWith('--analysis-mode='))
    ?.slice('--analysis-mode='.length) ?? 'lookup') as 'lookup' | 'clinical';
  const { core, store, corpus, target } = await openRealCorpus({
    corePath: corePathOverride,
    companions: corpusScope === 'all',
  });
  const scoped = new ScopedMedicalCore(core, 'all');

  const coreDbPath = resolve(
    REPOSITORY_ROOT,
    corePathOverride ?? 'apps/app/public/content/core.db',
  );
  const coreHash = createHash('sha256');
  for await (const bytes of createReadStream(coreDbPath)) coreHash.update(bytes);
  const coreDbSha256 = coreHash.digest('hex');
  const commit = execSync('git rev-parse HEAD', { cwd: REPOSITORY_ROOT }).toString().trim();

  const queries = analysisMode === 'clinical' ? buildClinicalQuerySet() : buildQuerySet();
  const searchCalls = observeStoreSearch(store);
  const rows = [];
  for (const { sourceId, query } of queries) {
    searchCalls.length = 0;
    const response = await scoped.search({
      query,
      mode: 'lexical',
      analysisMode,
      filters: {},
      limit: GROUP_LIMIT,
      includeSuggestions: false,
    });
    if (!response.ok) {
      rows.push({ sourceId, query, error: response.error.message });
      continue;
    }
    const { value } = response;

    // Observe the real execution. Replaying with a smaller limit changes the SQL candidate window.
    const branchHits = await Promise.all(
      value.diagnostics.branches.map(async (branch) => {
        const { hits } = findObservedBranch(searchCalls, branch.ftsQuery, branch.candidateCount);
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
      ...(analysisMode === 'clinical' ? { analysis: value.analysis } : {}),
      aliasMatches: value.diagnostics.aliasMatches,
      terms: value.diagnostics.terms,
      branches: branchHits,
      groups: value.groups.map((group) => ({
        documentId: group.documentId,
        targetDocumentId: target(group.documentId),
        documentKind: group.documentKind ?? null,
        contentKind: group.contentKind ?? null,
        bestScore: Math.round(group.bestScore * 1_000_000) / 1_000_000,
        results: group.results.map((result) => ({
          chunkId: result.chunkId,
          documentVersionId: result.documentVersionId,
          sectionId: result.sectionId,
          anchor: result.anchor,
          snippet: result.snippet,
          highlightedRanges: result.highlightedRanges,
          matchedTerms: result.matchedTerms,
          finalScore: Math.round(result.finalScore * 1_000_000) / 1_000_000,
        })),
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
    analysisMode,
    groupLimit: GROUP_LIMIT,
    hitsPerBranch: HITS_PER_BRANCH,
    queryCount: rows.length,
    queries: rows,
  };

  // search-golden.json (corpus=core, the default — what native/ and the emulator measurements
  // actually open) vs. search-golden.all.json (corpus=all, companion packs included) — two
  // filenames so the multi-pack variant, if ever generated, can never silently clobber the
  // core-only one the Kotlin port is checked against.
  const prefix = analysisMode === 'clinical' ? 'clinical-golden' : 'search-golden';
  const fileName = `${prefix}${corpusScope === 'all' ? '.all' : ''}.json`;
  const outputOverride = args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
  const outPath = resolve(
    REPOSITORY_ROOT,
    outputOverride ?? `native/shared/src/commonTest/resources/${fileName}`,
  );
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${rows.length} golden queries to ${outPath}`);
  console.log(`core.db sha256: ${coreDbSha256}`);
  console.log(`commit: ${commit}`);
}

await main();
