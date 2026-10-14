// SRCH1 (owner decision 2026-10-14): queries that name a drug class (tools/benchmarks/class-queries.json).
// Through the app's ScopedMedicalCore over the released core: the response carries the class card
// (`drugClass`: label, the ATC groups of the shared class vocabulary), the drugs of the class are its
// leading result groups (each with its `atcMatch`), and the text hits follow. Negatives (diseases,
// brands, ATC codes, ordinary phrases) carry no class.
//
//   bun tools/benchmarks/src/run-class-queries.ts [--check] [--show]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { comparisonDrugCodes } from '../../../apps/app/src/features/drug-comparison/comparison-atc-directory';
import { cardSlugOfDocumentId } from '../../../apps/app/src/features/drug-picker/card-id';
import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const check = args.includes('--check');
const show = args.includes('--show');

interface Fixture {
  readonly queries: readonly {
    readonly id: string;
    readonly query: string;
    readonly codes: readonly string[];
    readonly drugs: readonly string[];
  }[];
  readonly negatives: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/class-queries.json'), 'utf8'),
) as Fixture;

const { core } = await openRealCorpus({ companions: false });
const entries = await comparisonDrugCodes.entries();
const known = new Set(entries.map((entry) => entry.id.replace(/^esklp\.mnn\./u, '')));
const scopes: SearchScope[] = ['all', 'medications'];
const scoped = new Map(scopes.map((scope) => [scope, new ScopedMedicalCore(core, scope)]));

async function run(query: string, scope: SearchScope) {
  const response = await scoped.get(scope)?.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response) throw new Error(`no scope ${scope}`);
  if (!response.ok) {
    if (/no searchable terms/iu.test(response.error.message)) return undefined;
    throw new Error(response.error.message);
  }
  return response.value;
}

const failures: string[] = [];
const totals = { cards: 0, withCard: 0, groupsOk: 0, ledByDrugs: 0, expected: 0, found: 0, ms: 0 };
for (const item of fixture.queries) {
  for (const slug of item.drugs) {
    if (!known.has(slug))
      failures.push(`${item.id}: expected card «${slug}» is not in the directory`);
  }
  for (const scope of scopes) {
    const started = performance.now();
    const value = await run(item.query, scope);
    totals.ms += performance.now() - started;
    totals.cards += 1;
    const drugClass = value?.drugClass;
    if (!value || !drugClass) {
      failures.push(`${item.id} «${item.query}» [${scope}]: no class card`);
      continue;
    }
    totals.withCard += 1;
    const codes = drugClass.groups.map((group) => group.code);
    if (
      item.codes.some((code) =>
        codes.some((have) => have.startsWith(code) || code.startsWith(have)),
      )
    ) {
      totals.groupsOk += 1;
    } else {
      failures.push(
        `${item.id} «${item.query}» [${scope}]: groups ${codes.join(',')} ≠ ${item.codes.join(',')}`,
      );
    }
    const leading = value.groups.slice(0, drugClass.listed);
    if (leading.every((group) => group.atcMatch !== undefined)) totals.ledByDrugs += 1;
    else
      failures.push(
        `${item.id} «${item.query}» [${scope}]: the first ${drugClass.listed} groups are not all class drugs`,
      );
    const listed = new Set(leading.map((group) => cardSlugOfDocumentId(group.documentId)));
    for (const slug of item.drugs) {
      totals.expected += 1;
      if (listed.has(slug)) totals.found += 1;
      else if (show)
        failures.push(
          `${item.id} [${scope}]: «${slug}» is not among the ${drugClass.listed} listed drugs (${drugClass.drugCount} in the class)`,
        );
    }
    if (show && scope === 'all') {
      console.log(
        `${item.query.padEnd(40)} ${drugClass.label} · ${drugClass.drugCount} · ${leading
          .slice(0, 5)
          .map((group) => group.title.slice(0, 22))
          .join(', ')}`,
      );
    }
  }
}
let negativesClean = 0;
let negativeTotal = 0;
for (const query of fixture.negatives) {
  for (const scope of scopes) {
    negativeTotal += 1;
    const value = await run(query, scope);
    if (!value?.drugClass) negativesClean += 1;
    else failures.push(`negative «${query}» [${scope}] got the class «${value.drugClass.label}»`);
  }
}
await core.close();

console.log(
  `class queries: ${fixture.queries.length} classes × ${scopes.length} scopes = ${totals.cards}; card ${totals.withCard}/${totals.cards}; ` +
    `groups ${totals.groupsOk}/${totals.cards}; drugs lead ${totals.ledByDrugs}/${totals.cards}; ` +
    `expected drugs listed ${totals.found}/${totals.expected} (${(totals.found / totals.expected).toFixed(3)}); ` +
    `negatives clean ${negativesClean}/${negativeTotal}; mean ${(totals.ms / totals.cards).toFixed(0)} ms`,
);
for (const failure of failures) console.log(`  ! ${failure}`);
if (check && (totals.withCard !== totals.cards || negativesClean !== negativeTotal))
  process.exit(1);
