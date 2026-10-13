/**
 * Roadmap item 19 (TYPO1): spelling correction of misspelt words. Runs `typo-queries.json`
 * (build-typo-queries.ts) through the app's own `ScopedMedicalCore('all')` (lookup, lexical — the
 * «Все» tab) over the released corpus with the correction off and on, and prints hit@1 / hit@5
 * per set and variant, latency, and every control whose first ten groups changed.
 *
 *   bun tools/benchmarks/src/run-typo-queries.ts [--no-companions]
 *
 * A case hits when a group's target document is an expected one, or the group's title names the
 * source name (several documents share a trade name).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

interface Case {
  readonly id: string;
  readonly set: string;
  readonly variant: string;
  readonly query: string;
  readonly name: string;
  readonly expectedTargets: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../typo-queries.json'), 'utf8'),
) as { cases: readonly Case[]; controls: readonly { id: string; query: string }[] };

const normalize = (value: string) => value.toLowerCase().replaceAll('ё', 'е');
const percentile = (values: readonly number[], share: number) =>
  values.toSorted((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * share))
  ] ?? 0;
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

interface Outcome {
  readonly top: readonly string[];
  readonly rank: number;
  readonly ms: number;
  readonly corrected: string | null;
}

async function runConfiguration(spellingCorrection: boolean) {
  const { core, target } = await openRealCorpus({
    companions: !process.argv.includes('--no-companions'),
    coreOptions: { spellingCorrection, icdBridge: false },
  });
  const scoped = new ScopedMedicalCore(core, 'all');
  const search = async (query: string) => {
    const started = performance.now();
    const response = await scoped.search({
      query,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    const ms = performance.now() - started;
    if (!response.ok) return { groups: [], ms, corrected: null };
    return {
      groups: response.value.groups,
      ms,
      corrected: response.value.queryCorrection?.correctedQuery ?? null,
    };
  };
  // Warm the document index, aliases and the spelling vocabulary, as a running app has them.
  await search('парацетамол');
  await search('оменция');
  const cases = new Map<string, Outcome>();
  for (const item of fixture.cases) {
    const { groups, ms, corrected } = await search(item.query);
    const name = normalize(item.name);
    const rank = groups
      .slice(0, 5)
      .findIndex(
        (group) =>
          item.expectedTargets.includes(target(group.documentId)) ||
          normalize(group.title).startsWith(name) ||
          normalize(group.title).includes(` ${name}`),
      );
    cases.set(item.id, {
      top: groups.map((group) => target(group.documentId)),
      rank,
      ms,
      corrected,
    });
  }
  const controls = new Map<string, Outcome>();
  for (const item of fixture.controls) {
    const { groups, ms, corrected } = await search(item.query);
    controls.set(item.id, {
      top: groups.map((group) => target(group.documentId)),
      rank: 0,
      ms,
      corrected,
    });
  }
  await core.close();
  return { cases, controls };
}

const off = await runConfiguration(false);
const on = await runConfiguration(true);

const row = (label: string, items: readonly Case[]) => {
  const cell = (cases: ReadonlyMap<string, Outcome>) => {
    const outcomes = items.map((item) => cases.get(item.id) as Outcome);
    return `${mean(outcomes.map((o) => Number(o.rank === 0))).toFixed(3)} / ${mean(
      outcomes.map((o) => Number(o.rank >= 0)),
    ).toFixed(3)}`;
  };
  console.log(
    `${label.padEnd(24)} n=${String(items.length).padEnd(4)} off ${cell(off.cases)}   on ${cell(on.cases)}`,
  );
};
console.log('\nhit@1 / hit@5');
for (const key of [...new Set(fixture.cases.map((item) => `${item.set}/${item.variant}`))])
  row(
    key,
    fixture.cases.filter((item) => `${item.set}/${item.variant}` === key),
  );
for (const variant of ['neighbour', 'sound', 'other', 'late'])
  row(
    `TOTAL ${variant}`,
    fixture.cases.filter((item) => item.variant === variant),
  );
row(
  'TOTAL first letters',
  fixture.cases.filter((item) => item.variant !== 'late'),
);

const corrected = fixture.cases.filter((item) => on.cases.get(item.id)?.corrected);
const latency = (cases: ReadonlyMap<string, Outcome>, items: readonly { id: string }[]) => {
  const values = items.map((item) => (cases.get(item.id) as Outcome).ms);
  return `${Math.round(percentile(values, 0.5))}/${Math.round(percentile(values, 0.95))}`;
};
console.log(
  `\ncorrected cases ${corrected.length}/${fixture.cases.length}; latency p50/p95 ms of those off ${latency(off.cases, corrected)} on ${latency(on.cases, corrected)}; all cases off ${latency(off.cases, fixture.cases)} on ${latency(on.cases, fixture.cases)}`,
);

let changed = 0;
for (const control of fixture.controls) {
  const before = off.controls.get(control.id) as Outcome;
  const after = on.controls.get(control.id) as Outcome;
  if (before.top.join('|') === after.top.join('|')) continue;
  changed += 1;
  console.log(
    `control changed: ${control.id} «${control.query}» -> ${after.corrected ?? '(no correction)'}`,
  );
}
console.log(
  `controls ${fixture.controls.length}: changed ${changed}; latency p50/p95 ms off ${latency(off.controls, fixture.controls)} on ${latency(on.controls, fixture.controls)}`,
);

const regressions = fixture.cases.filter(
  (item) =>
    (off.cases.get(item.id) as Outcome).rank >= 0 && (on.cases.get(item.id) as Outcome).rank < 0,
);
console.log(`\nhit@5 lost with the correction on (${regressions.length}):`);
for (const item of regressions)
  console.log(`  ${item.id} «${item.query}» -> ${(on.cases.get(item.id) as Outcome).corrected}`);
const misses = fixture.cases.filter(
  (item) => item.variant !== 'late' && (on.cases.get(item.id) as Outcome).rank < 0,
);
console.log(`\nfirst-letter misses with the correction on (${misses.length}):`);
for (const item of misses.slice(0, Number(process.env['MISSES'] ?? 40)))
  console.log(
    `  ${item.id} «${item.query}» (${item.name}) -> ${(on.cases.get(item.id) as Outcome).corrected ?? '-'}`,
  );
