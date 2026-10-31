/**
 * Roadmap items 19 and 24 (TYPO1, TYPO2): spelling correction of misspelt words. Runs
 * `typo-queries.json` (build-typo-queries.ts) through the app's own `ScopedMedicalCore('all')`
 * (lookup, lexical — the «Все» tab) over the released corpus with the correction off and on, and
 * prints hit@1 / hit@5 per set and variant, latency, and every control whose first ten groups
 * changed.
 *
 *   bun tools/benchmarks/src/run-typo-queries.ts [--no-companions] [--tier=basic|hard|all|none]
 *       [--no-off] [--sample=N] [--save=outcomes.json] [--before=outcomes.json]
 *
 * `--save` writes the correction-on outcomes of this run, `--before` reads such a file from an
 * earlier build of the correction and prints it as a column between «off» and «on», so the code
 * before a change is measured once. `--no-off` skips the (unchanging) correction-off run.
 *
 * A case hits when a group's target document is an expected one, or the group's title names the
 * source name (several documents share a trade name).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

interface Case {
  readonly id: string;
  readonly set: string;
  readonly variant: string;
  readonly tier?: 'hard';
  readonly query: string;
  readonly name: string;
  readonly expectedTargets: readonly string[];
}
const option = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const tier = option('tier') ?? 'all';
/** `--sample=4` keeps every fourth case: a quick look while tuning, never a reported number. */
const sampleEvery = Number(option('sample') ?? 1);
const parsed = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../typo-queries.json'), 'utf8'),
) as {
  cases: readonly Case[];
  controls: readonly { id: string; query: string }[];
  nonsense?: readonly string[];
};
const fixture = {
  controls: parsed.controls,
  nonsense: parsed.nonsense ?? [],
  cases: parsed.cases
    .filter(
      (item) => tier === 'all' || (tier !== 'none' && (tier === 'hard') === (item.tier === 'hard')),
    )
    .filter((_, index) => index % sampleEvery === 0),
};

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
  // The ceiling: a case whose own correctly typed name misses the top five cannot be repaired by
  // any spelling correction (a ranking miss), so the totals also show the reachable cases.
  const reachable = new Set<string>();
  if (spellingCorrection) {
    const byName = new Map<string, boolean>();
    for (const item of fixture.cases) {
      if (!byName.has(item.name)) {
        const { groups } = await search(item.name);
        const name = normalize(item.name);
        byName.set(
          item.name,
          groups
            .slice(0, 5)
            .some(
              (group) =>
                item.expectedTargets.includes(target(group.documentId)) ||
                normalize(group.title).startsWith(name) ||
                normalize(group.title).includes(` ${name}`),
            ),
        );
      }
      if (byName.get(item.name)) reachable.add(item.id);
    }
  }
  const nonsense = new Map<string, Outcome>();
  for (const word of fixture.nonsense) {
    const { groups, ms, corrected } = await search(word);
    nonsense.set(word, {
      top: groups.map((group) => target(group.documentId)),
      rank: 0,
      ms,
      corrected,
    });
  }
  await core.close();
  return { cases, controls, nonsense, reachable };
}

const withOff = !process.argv.includes('--no-off');
const off = withOff ? await runConfiguration(false) : null;
const on = await runConfiguration(true);
const before = option('before')
  ? (new Map(
      option('before')
        ?.split(',')
        .flatMap((path) =>
          Object.entries(
            JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, Outcome>,
          ),
        ),
    ) as ReadonlyMap<string, Outcome>)
  : null;
const savePath = option('save');
if (savePath)
  writeFileSync(
    resolve(savePath),
    JSON.stringify(
      Object.fromEntries([
        ...on.cases,
        ...on.controls,
        ...[...on.nonsense].map(([word, outcome]) => [`nonsense:${word}`, outcome] as const),
      ]),
    ),
  );

const row = (label: string, items: readonly Case[]) => {
  const cell = (cases: ReadonlyMap<string, Outcome> | null) => {
    if (!cases) return '-'.padEnd(13);
    const outcomes = items.map((item) => cases.get(item.id) as Outcome);
    return `${mean(outcomes.map((o) => Number(o.rank === 0))).toFixed(3)} / ${mean(
      outcomes.map((o) => Number(o.rank >= 0)),
    ).toFixed(3)}`;
  };
  console.log(
    `${label.padEnd(24)} n=${String(items.length).padEnd(4)} off ${cell(off?.cases ?? null)}   before ${cell(before)}   on ${cell(on.cases)}`,
  );
};
const basic = fixture.cases.filter((item) => item.tier !== 'hard');
const hard = fixture.cases.filter((item) => item.tier === 'hard');
console.log('\nhit@1 / hit@5');
for (const key of [...new Set(fixture.cases.map((item) => `${item.set}/${item.variant}`))])
  row(
    key,
    fixture.cases.filter((item) => `${item.set}/${item.variant}` === key),
  );
for (const variant of ['neighbour', 'sound', 'other', 'late'])
  if (basic.some((item) => item.variant === variant))
    row(
      `TOTAL ${variant}`,
      basic.filter((item) => item.variant === variant),
    );
if (basic.length > 0)
  row(
    'TOTAL first letters',
    basic.filter((item) => item.variant !== 'late'),
  );
for (const variant of [...new Set(hard.map((item) => item.variant))])
  row(
    `HARD ${variant}`,
    hard.filter((item) => item.variant === variant),
  );
if (hard.length > 0) row('HARD all', hard);
const reachable = (items: readonly Case[]) => items.filter((item) => on.reachable.has(item.id));
if (basic.length > 0)
  row('first letters, reachable', reachable(basic.filter((item) => item.variant !== 'late')));
if (hard.length > 0) row('HARD all, reachable', reachable(hard));

const corrected = fixture.cases.filter((item) => on.cases.get(item.id)?.corrected);
const latency = (cases: ReadonlyMap<string, Outcome> | null, items: readonly { id: string }[]) => {
  if (!cases) return '-';
  const values = items.map((item) => (cases.get(item.id) as Outcome).ms);
  return `${Math.round(percentile(values, 0.5))}/${Math.round(percentile(values, 0.95))}`;
};
console.log(
  `\ncorrected cases ${corrected.length}/${fixture.cases.length}; latency p50/p95 ms of those off ${latency(off?.cases ?? null, corrected)} before ${latency(before, corrected)} on ${latency(on.cases, corrected)}; all cases off ${latency(off?.cases ?? null, fixture.cases)} before ${latency(before, fixture.cases)} on ${latency(on.cases, fixture.cases)}`,
);

let changed = 0;
// Against the correction off, or (without an off run) against the earlier build's outcomes.
const controlReference = (id: string): Outcome | undefined =>
  off ? off.controls.get(id) : before?.get(id);
for (const control of fixture.controls) {
  const earlier = controlReference(control.id);
  const after = on.controls.get(control.id) as Outcome;
  if (!earlier || earlier.top.join('|') === after.top.join('|')) continue;
  changed += 1;
  console.log(
    `control changed: ${control.id} «${control.query}» -> ${after.corrected ?? '(no correction)'}`,
  );
}
console.log(
  `controls ${fixture.controls.length}: changed ${off || before ? changed : 'n/a'} (against ${off ? 'off' : 'before'}); latency p50/p95 ms off ${latency(off?.controls ?? null, fixture.controls)} on ${latency(on.controls, fixture.controls)}`,
);

const rewritten = (outcomes: ReadonlyMap<string, Outcome> | null) =>
  outcomes
    ? fixture.nonsense.filter((word) => outcomes.get(`nonsense:${word}`)?.corrected).length
    : 'n/a';
const nonsenseOn = [...on.nonsense.values()].filter((outcome) => outcome.corrected).length;
console.log(
  `\nnonsense words rewritten by a correction: ${nonsenseOn}/${fixture.nonsense.length} (before ${rewritten(before)})`,
);

const reference = off?.cases ?? before;
const regressions = reference
  ? fixture.cases.filter(
      (item) =>
        (reference.get(item.id) as Outcome).rank >= 0 &&
        (on.cases.get(item.id) as Outcome).rank < 0,
    )
  : [];
console.log(
  `\nhit@5 lost with the correction on, against ${off ? 'off' : 'before'} (${regressions.length}):`,
);
for (const item of regressions)
  console.log(`  ${item.id} «${item.query}» -> ${(on.cases.get(item.id) as Outcome).corrected}`);
const misses = fixture.cases.filter(
  (item) => item.variant !== 'late' && (on.cases.get(item.id) as Outcome).rank < 0,
);
console.log(`\nmisses with the correction on (${misses.length}):`);
for (const item of misses.slice(0, Number(process.env['MISSES'] ?? 40)))
  console.log(
    `  ${item.id} «${item.query}» (${item.name}) -> ${(on.cases.get(item.id) as Outcome).corrected ?? '-'}`,
  );
