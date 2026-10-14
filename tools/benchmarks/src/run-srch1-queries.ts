// SRCH1: the search fixes of the 2026-10-14 QA pass, on the released core through the app's own
// ScopedMedicalCore (tools/benchmarks/srch1-queries.json, built by build-srch1-queries.ts).
//
//   brand      a trade name finds its substance card first («Аспирин» → ацетилсалициловая кислота), in
//              «Все источники» and in «Препараты»
//   inn        a substance name finds its own card first
//   homeopathy a name that is an ordinary substance puts no homeopathic mixture in front of it
//   nonsense   text with no real word in it finds nothing («<script>alert(1)</script>»)
//   control    real names, codes, Latin terms and misspellings keep finding something
//
//   bun tools/benchmarks/src/run-srch1-queries.ts [--check] [--show] [--kind=brand]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cardSlugOfDocumentId } from '../../../apps/app/src/features/drug-interactions/drug-candidates';
import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const show = args.includes('--show');
const check = args.includes('--check');
const onlyKind = args.find((a) => a.startsWith('--kind='))?.slice(7);

interface Fixture {
  readonly queries: readonly {
    readonly id: string;
    readonly kind: 'brand' | 'inn';
    readonly query: string;
    readonly expectedSlugs: readonly string[];
  }[];
  readonly nonsense: readonly string[];
  readonly controls: readonly string[];
  readonly homeopathy: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/srch1-queries.json'), 'utf8'),
) as Fixture;

const { core } = await openRealCorpus({ companions: false });
const scoped = new Map<SearchScope, ScopedMedicalCore>();
const scopeCore = (scope: SearchScope): ScopedMedicalCore => {
  let value = scoped.get(scope);
  if (!value) {
    value = new ScopedMedicalCore(core, scope);
    scoped.set(scope, value);
  }
  return value;
};
async function groupsOf(query: string, scope: SearchScope) {
  const response = await scopeCore(scope).search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  // A query with no searchable term is answered with an error the UI shows as «ничего не найдено».
  if (!response.ok) {
    if (/no searchable terms/iu.test(response.error.message)) return [];
    throw new Error(response.error.message);
  }
  return response.value.groups;
}

interface Tally {
  total: number;
  at1: number;
  at3: number;
  failures: string[];
}
const tallies = new Map<string, Tally>();
const tally = (name: string): Tally => {
  let value = tallies.get(name);
  if (!value) {
    value = { total: 0, at1: 0, at3: 0, failures: [] };
    tallies.set(name, value);
  }
  return value;
};

for (const item of fixture.queries) {
  if (onlyKind && item.kind !== onlyKind) continue;
  for (const scope of ['all', 'medications'] as const) {
    const groups = await groupsOf(item.query, scope);
    const slugs = groups.map((g) => cardSlugOfDocumentId(g.documentId));
    const rank = slugs.findIndex((slug) => slug !== null && item.expectedSlugs.includes(slug));
    const t = tally(`${item.kind}/${scope}`);
    t.total += 1;
    if (rank === 0) t.at1 += 1;
    if (rank >= 0 && rank < 3) t.at3 += 1;
    if (rank !== 0) {
      t.failures.push(
        `${item.id} «${item.query}» rank ${rank} → ${groups
          .slice(0, 3)
          .map((g) => g.title.slice(0, 40))
          .join(' | ')}`,
      );
    }
  }
}

if (!onlyKind || onlyKind === 'homeopathy') {
  const index = JSON.parse(
    readFileSync(
      resolve(REPOSITORY_ROOT, 'apps/app/src/features/drug-comparison/data/comparison-index.json'),
      'utf8',
    ),
  ) as { cards: { s: string; n: string; g: string[] }[] };
  const homeopathic = new Set(
    index.cards.filter((card) => card.g.some((g) => g.includes('гомеопат'))).map((card) => card.s),
  );
  for (const query of fixture.homeopathy) {
    const groups = await groupsOf(query, 'medications');
    const word = query.toLocaleLowerCase('ru-RU').slice(0, 5);
    const named = (title: string) => title.toLocaleLowerCase('ru-RU').includes(word);
    const kinds = groups.map((g) => {
      const slug = cardSlugOfDocumentId(g.documentId);
      return {
        homeo: slug !== null && homeopathic.has(slug),
        named: named(g.title),
        title: g.title,
      };
    });
    // Fine: no homeopathic mixture stands in front of an ordinary card that names the query.
    const firstOrdinary = kinds.findIndex((k) => !k.homeo && k.named);
    const firstHomeo = kinds.findIndex((k) => k.homeo);
    const t = tally('homeopathy/medications');
    t.total += 1;
    if (firstOrdinary < 0 || firstHomeo < 0 || firstOrdinary < firstHomeo) t.at1 += 1;
    else
      t.failures.push(
        `«${query}» homeopathic #${firstHomeo + 1} before ordinary #${firstOrdinary + 1}: ${kinds[firstHomeo]?.title.slice(0, 60)}`,
      );
  }
}
if (!onlyKind || onlyKind === 'nonsense') {
  for (const query of fixture.nonsense) {
    for (const scope of ['all', 'medications'] as const) {
      const groups = await groupsOf(query, scope);
      const t = tally(`nonsense/${scope}`);
      t.total += 1;
      if (groups.length === 0) t.at1 += 1;
      else
        t.failures.push(`«${query}» [${scope}] ${groups.length}: ${groups[0]?.title.slice(0, 50)}`);
    }
  }
}
if (!onlyKind || onlyKind === 'control') {
  for (const query of fixture.controls) {
    const groups = await groupsOf(query, 'all');
    const t = tally('control/all');
    t.total += 1;
    if (groups.length > 0) t.at1 += 1;
    else t.failures.push(`«${query}» found nothing`);
  }
}
await core.close();

let failed = false;
for (const [name, t] of tallies) {
  console.log(
    `${name.padEnd(24)} n=${String(t.total).padStart(3)}  first ${t.at1}/${t.total} (${(t.at1 / t.total).toFixed(3)})  top3 ${t.at3}/${t.total}`,
  );
  if (show) for (const failure of t.failures.slice(0, 40)) console.log(`    ! ${failure}`);
  if (name.startsWith('nonsense') || name.startsWith('control') || name.startsWith('homeopathy')) {
    if (t.at1 !== t.total) failed = true;
  }
}
if (check && failed) process.exit(1);
