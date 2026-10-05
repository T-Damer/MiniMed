// Exact / lookup search probe (S2). Prints, for every lookup query of the release benchmark and
// the doctor-lookup set, the cases that miss the expected document at rank 1 together with the
// top-5 titles, so each miss can be classified by cause. A second block lists ad-hoc «nonsense
// match» queries (service words inside a longer word, form words acting as the subject) and their
// top-5 titles in the «Все источники» and «Лекарства» scopes.
//
// Everything runs lexically (`mode: 'lexical'`, `analysisMode: 'lookup'`) through ScopedMedicalCore
// over the released packs, as the app does for these scopes. Run: `bun tools/benchmarks/src/probe-exact-lookup.ts`.
// Extra queries: `--query="…"` (repeatable). `--misses-only` hides rows that hit at rank 1.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SearchResultGroup } from '@localmed/contracts';

import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
for (const arg of args)
  if (!/^(?:--query=.+|--misses-only)$/u.test(arg)) throw new Error(`Unknown argument ${arg}`);
const missesOnly = args.includes('--misses-only');
const extraQueries = args.flatMap((arg) => (arg.startsWith('--query=') ? [arg.slice(8)] : []));

interface Fixture {
  readonly id: string;
  readonly query: string;
  readonly expected: readonly string[];
  readonly scope: SearchScope;
}
const read = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')) as T;
const releaseFixtures = [
  'tools/benchmarks/clinical-guideline-queries.json',
  'tools/benchmarks/medication-lookup-queries.json',
  'tools/benchmarks/doctor-workflow-queries.json',
].flatMap((path) =>
  read<
    readonly {
      id: string;
      query: string;
      expectedDocumentIds: readonly string[];
      scope?: 'medications';
    }[]
  >(path).map(
    (item): Fixture => ({
      id: item.id,
      query: item.query,
      expected: item.expectedDocumentIds,
      scope: item.scope ?? 'all',
    }),
  ),
);
const doctorFixtures = read<
  readonly { id: string; query: string; expectedTargets: readonly string[] }[]
>('tools/benchmarks/doctor-lookup-queries.json').map(
  (item): Fixture => ({
    id: item.id,
    query: item.query,
    expected: item.expectedTargets,
    scope: 'all',
  }),
);

/** Queries that used to return nonsense; each is shown in both scopes. */
const NONSENSE_QUERIES = [
  'от головной боли',
  'таблетки от головы',
  'от давления',
  'обезболивающее',
  'от кашля',
  'капли от насморка',
  'при температуре',
  'сироп от кашля детям',
  'таблетки от изжоги',
  'мазь от ушибов',
  'головная боль',
  'давление',
  'что пить при поносе',
  ...extraQueries,
];

const { core, target } = await openRealCorpus({ companions: true });
const scoped = new Map<SearchScope, ScopedMedicalCore>();
const scopeCore = (scope: SearchScope) => {
  const existing = scoped.get(scope);
  if (existing) return existing;
  const created = new ScopedMedicalCore(core, scope);
  scoped.set(scope, created);
  return created;
};
const search = async (query: string, scope: SearchScope) => {
  const response = await scopeCore(scope).search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${query}: ${response.error.message}`);
  return response.value.groups as readonly SearchResultGroup[];
};
const titles = (groups: readonly SearchResultGroup[]) =>
  groups
    .slice(0, 5)
    .map((group, index) => `    ${index + 1}. ${group.title} [${target(group.documentId)}]`)
    .join('\n');

for (const [label, fixtures] of [
  ['release lookup queries', releaseFixtures],
  ['doctor lookup queries', doctorFixtures],
] as const) {
  let hits1 = 0;
  let hits5 = 0;
  console.log(`\n== ${label} (lexical lookup path) ==`);
  for (const fixture of fixtures) {
    const groups = await search(fixture.query, fixture.scope);
    const rank = groups
      .slice(0, 5)
      .findIndex((group) => fixture.expected.includes(target(group.documentId)));
    if (rank === 0) hits1 += 1;
    if (rank >= 0) hits5 += 1;
    if (missesOnly && rank === 0) continue;
    console.log(
      `\n[${rank === 0 ? 'HIT@1' : rank > 0 ? `HIT@${rank + 1}` : 'MISS'}] ${fixture.id} (${fixture.scope})\n  q: ${fixture.query}\n  expected: ${fixture.expected.join(', ')}\n${titles(groups)}`,
    );
  }
  console.log(`\n${label}: R@1 ${hits1}/${fixtures.length}, R@5 ${hits5}/${fixtures.length}`);
}

console.log('\n== nonsense-match probes ==');
for (const query of NONSENSE_QUERIES)
  for (const scope of ['all', 'medications'] as const)
    console.log(`\n[${scope}] ${query}\n${titles(await search(query, scope))}`);
await core.close();
