// SRCH1 (owner decision 2026-10-14): queries that name a drug class (tools/benchmarks/class-queries.json).
// Through the app's ScopedMedicalCore over the released core: the response carries the class card
// (`drugClass`: label, the ATC groups of the shared class vocabulary), the drugs of the class are its
// leading result groups (each with its `atcMatch`), and the text hits follow. Negatives (diseases,
// brands, ATC codes, ordinary phrases) carry no class.
// SRCH2: the same card and drugs for a class word inside a longer query («макролиды детям»); the
// documents below the class drugs must keep the order the query has when the class lead is off.
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
  readonly phrases: readonly {
    readonly id: string;
    readonly query: string;
    readonly class: string;
  }[];
  readonly phraseNegatives: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/class-queries.json'), 'utf8'),
) as Fixture;

const { core } = await openRealCorpus({ companions: false });
// The same corpus with the class lead switched off: the order the documents have without it.
const { core: plainCore } = await openRealCorpus({
  companions: false,
  coreOptions: { drugCodes: { ...comparisonDrugCodes, classOf: undefined } as never },
});
const entries = await comparisonDrugCodes.entries();
const known = new Set(entries.map((entry) => entry.id.replace(/^esklp\.mnn\./u, '')));
const scopes: SearchScope[] = ['all', 'medications'];
const scoped = new Map(scopes.map((scope) => [scope, new ScopedMedicalCore(core, scope)]));
const plain = new Map(scopes.map((scope) => [scope, new ScopedMedicalCore(plainCore, scope)]));

async function run(query: string, scope: SearchScope, withClass = true) {
  const response = await (withClass ? scoped : plain).get(scope)?.search({
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

// SRCH2: a class word inside a longer query.
const byId = new Map(fixture.queries.map((item) => [item.id, item]));
const phraseTotals = { cards: 0, withCard: 0, groupsOk: 0, ledByDrugs: 0, drugOk: 0, orderOk: 0 };
for (const item of fixture.phrases) {
  const base = byId.get(item.class);
  if (!base) {
    failures.push(`${item.id}: unknown class ${item.class}`);
    continue;
  }
  for (const scope of scopes) {
    phraseTotals.cards += 1;
    const value = await run(item.query, scope);
    const drugClass = value?.drugClass;
    if (!value || !drugClass) {
      failures.push(`${item.id} «${item.query}» [${scope}]: no class card`);
      continue;
    }
    phraseTotals.withCard += 1;
    const codes = drugClass.groups.map((group) => group.code);
    if (
      base.codes.some((code) =>
        codes.some((have) => have.startsWith(code) || code.startsWith(have)),
      )
    )
      phraseTotals.groupsOk += 1;
    else
      failures.push(
        `${item.id} «${item.query}» [${scope}]: groups ${codes.join(',')} ≠ ${base.codes.join(',')}`,
      );
    const leading = value.groups.slice(0, drugClass.listed);
    if (leading.every((group) => group.atcMatch !== undefined)) phraseTotals.ledByDrugs += 1;
    else
      failures.push(
        `${item.id} «${item.query}» [${scope}]: the first ${drugClass.listed} groups are not all class drugs`,
      );
    // Every leading drug carries a code of one of the class's groups (the three commonest, not the
    // hand-picked ones: a big class like the antifungals lists others first).
    if (
      leading.every((group) =>
        codes.some(
          (code) =>
            group.atcMatch?.code.startsWith(code) || group.atcMatch?.registryCode?.startsWith(code),
        ),
      )
    )
      phraseTotals.drugOk += 1;
    else
      failures.push(
        `${item.id} «${item.query}» [${scope}]: a leading drug carries no code of ${codes.join(', ')}`,
      );
    const listed = new Set(leading.map((group) => cardSlugOfDocumentId(group.documentId)));
    if (show && !base.drugs.some((slug) => listed.has(slug)))
      console.log(
        `  (none of the expected ${base.drugs.join(', ')} among the ${drugClass.listed} listed: ${[...listed].join(', ')})`,
      );
    // The documents: the groups below the class drugs, minus the drugs, in the order of the plain search.
    const classIds = new Set(leading.map((group) => group.documentId));
    const below = value.groups.slice(drugClass.listed).map((group) => group.documentId);
    const without = await run(item.query, scope, false);
    const expected = (without?.groups ?? [])
      .map((group) => group.documentId)
      .filter((id) => !classIds.has(id));
    const compared = Math.min(5, expected.length);
    if (below.slice(0, compared).every((id, position) => id === expected[position]))
      phraseTotals.orderOk += 1;
    else
      failures.push(
        `${item.id} «${item.query}» [${scope}]: the documents below the class are not in the plain order`,
      );
    if (show && scope === 'all')
      console.log(
        `${item.query.padEnd(46)} ${drugClass.label} · ${drugClass.listed}/${drugClass.drugCount} · ${leading
          .slice(0, 4)
          .map((group) => group.title.slice(0, 18))
          .join(', ')}`,
      );
  }
}
let phraseNegativesClean = 0;
let phraseNegativeTotal = 0;
for (const query of fixture.phraseNegatives) {
  for (const scope of scopes) {
    phraseNegativeTotal += 1;
    const value = await run(query, scope);
    if (!value?.drugClass) phraseNegativesClean += 1;
    else
      failures.push(
        `phrase negative «${query}» [${scope}] got the class «${value.drugClass.label}»`,
      );
  }
}
await core.close();
await plainCore.close();

console.log(
  `class queries: ${fixture.queries.length} classes × ${scopes.length} scopes = ${totals.cards}; card ${totals.withCard}/${totals.cards}; ` +
    `groups ${totals.groupsOk}/${totals.cards}; drugs lead ${totals.ledByDrugs}/${totals.cards}; ` +
    `expected drugs listed ${totals.found}/${totals.expected} (${(totals.found / totals.expected).toFixed(3)}); ` +
    `negatives clean ${negativesClean}/${negativeTotal}; mean ${(totals.ms / totals.cards).toFixed(0)} ms`,
);
console.log(
  `class in a longer query: ${fixture.phrases.length} queries × ${scopes.length} scopes = ${phraseTotals.cards}; card ${phraseTotals.withCard}/${phraseTotals.cards}; ` +
    `groups ${phraseTotals.groupsOk}/${phraseTotals.cards}; drugs lead ${phraseTotals.ledByDrugs}/${phraseTotals.cards}; ` +
    `leading drugs in the class ${phraseTotals.drugOk}/${phraseTotals.cards}; documents in the plain order ${phraseTotals.orderOk}/${phraseTotals.cards}; ` +
    `negatives clean ${phraseNegativesClean}/${phraseNegativeTotal}`,
);
for (const failure of failures) console.log(`  ! ${failure}`);
if (
  check &&
  (totals.withCard !== totals.cards ||
    negativesClean !== negativeTotal ||
    phraseTotals.withCard !== phraseTotals.cards ||
    phraseTotals.groupsOk !== phraseTotals.cards ||
    phraseTotals.ledByDrugs !== phraseTotals.cards ||
    phraseTotals.drugOk !== phraseTotals.cards ||
    phraseTotals.orderOk !== phraseTotals.cards ||
    phraseNegativesClean !== phraseNegativeTotal)
)
  process.exit(1);
