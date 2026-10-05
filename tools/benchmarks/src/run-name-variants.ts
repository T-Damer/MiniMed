/**
 * Roadmap item 3 (S3): keyboard-layout / transliteration fallback for names. Runs the generated
 * `name-variant-queries.json` (build-name-variant-queries.ts) through the app's own
 * `ScopedMedicalCore('all')` (lookup, lexical — the «Все» tab) over the released corpus twice, with
 * the fallback off and on, and prints hit@1 / hit@5 and latency per set and variant.
 *
 *   bun tools/benchmarks/src/run-name-variants.ts [--no-companions] [--only=on|off]
 *
 * A case hits when a group's target document is an expected one, or the group's title names the
 * source name (several documents share a trade name). Controls (Latin/English terms, codes and
 * correctly typed Russian names) must return the same first ten groups with the fallback on; a
 * control the fallback rewrote is listed so that it can be judged by hand.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SearchResultGroup } from '@localmed/contracts';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const only = process.argv.find((item) => item.startsWith('--only='))?.slice(7);

interface Case {
  readonly id: string;
  readonly set: string;
  readonly variant: string;
  readonly query: string;
  readonly name: string;
  readonly expectedTargets: readonly string[];
}
interface Control {
  readonly id: string;
  readonly kind: string;
  readonly query: string;
}
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../name-variant-queries.json'), 'utf8'),
) as { cases: Case[]; controls: Control[] };

const normalize = (value: string) => value.toLowerCase().replaceAll('ё', 'е');
const percentile = (values: readonly number[], share: number) =>
  values.toSorted((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * share))
  ] ?? 0;

interface Outcome {
  readonly top: readonly string[];
  readonly rank: number;
  readonly ms: number;
  readonly rewrite: string | null;
}

async function runConfiguration(nameVariants: boolean) {
  const { core, target } = await openRealCorpus({
    companions: !process.argv.includes('--no-companions'),
    coreOptions: { nameVariants, icdBridge: false },
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
    if (!response.ok) return { groups: [] as readonly SearchResultGroup[], ms, rewrite: null };
    return {
      groups: response.value.groups as readonly SearchResultGroup[],
      ms,
      rewrite: response.value.queryRewrite
        ? `${response.value.queryRewrite.kind}:${response.value.queryRewrite.query}`
        : null,
    };
  };
  // Warm the document index and aliases, as a running app has them.
  await search('парацетамол');
  const cases = new Map<string, Outcome>();
  for (const item of fixture.cases) {
    const { groups, ms, rewrite } = await search(item.query);
    const name = normalize(item.name);
    const rank = groups
      .slice(0, 5)
      .findIndex(
        (group) =>
          item.expectedTargets.includes(target(group.documentId)) ||
          normalize(group.title).startsWith(name) ||
          normalize(group.title).includes(` ${name}`),
      );
    cases.set(item.id, { top: groups.map((group) => target(group.documentId)), rank, ms, rewrite });
  }
  const controls = new Map<string, Outcome>();
  for (const item of fixture.controls) {
    const { groups, ms, rewrite } = await search(item.query);
    controls.set(item.id, {
      top: groups.map((group) => target(group.documentId)),
      rank: 0,
      ms,
      rewrite,
    });
  }
  await core.close();
  return { cases, controls };
}

const results = new Map<string, Awaited<ReturnType<typeof runConfiguration>>>();
for (const nameVariants of [false, true]) {
  const label = nameVariants ? 'on' : 'off';
  if (only && only !== label) continue;
  results.set(label, await runConfiguration(nameVariants));
}

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
console.log(`\nhit@1 / hit@5 per set and variant (n per row = ${fixture.cases.length / 12})`);
const keys = [...new Set(fixture.cases.map((item) => `${item.set}/${item.variant}`))];
for (const key of keys) {
  const items = fixture.cases.filter((item) => `${item.set}/${item.variant}` === key);
  const cells = [...results].map(([label, { cases }]) => {
    const outcomes = items.map((item) => cases.get(item.id) as Outcome);
    return `${label}: ${mean(outcomes.map((o) => Number(o.rank === 0))).toFixed(2)} / ${mean(
      outcomes.map((o) => Number(o.rank >= 0)),
    ).toFixed(2)}`;
  });
  console.log(`${key.padEnd(24)} n=${String(items.length).padEnd(3)} ${cells.join('   ')}`);
}
for (const variant of ['layout', 'latin', 'latin-passport', 'latin-inn', 'layout-latin', 'all']) {
  const items = fixture.cases.filter((item) => variant === 'all' || item.variant === variant);
  const cells = [...results].map(([label, { cases }]) => {
    const outcomes = items.map((item) => cases.get(item.id) as Outcome);
    return `${label}: ${mean(outcomes.map((o) => Number(o.rank === 0))).toFixed(3)} / ${mean(
      outcomes.map((o) => Number(o.rank >= 0)),
    ).toFixed(3)}`;
  });
  console.log(
    `TOTAL ${variant.padEnd(18)} n=${String(items.length).padEnd(3)} ${cells.join('   ')}`,
  );
}
const on = results.get('on');
const off = results.get('off');
if (on && off) {
  const rewritten = fixture.cases.filter((item) => on.cases.get(item.id)?.rewrite);
  const latency = rewritten.map((item) => (on.cases.get(item.id) as Outcome).ms);
  const baseline = rewritten.map((item) => (off.cases.get(item.id) as Outcome).ms);
  console.log(
    `\nrewritten cases ${rewritten.length}/${fixture.cases.length}; latency p50/p95 ms off ${Math.round(percentile(baseline, 0.5))}/${Math.round(percentile(baseline, 0.95))} on ${Math.round(percentile(latency, 0.5))}/${Math.round(percentile(latency, 0.95))}`,
  );
  const allOn = fixture.cases.map((item) => (on.cases.get(item.id) as Outcome).ms);
  const allOff = fixture.cases.map((item) => (off.cases.get(item.id) as Outcome).ms);
  console.log(
    `all cases latency p50/p95 ms off ${Math.round(percentile(allOff, 0.5))}/${Math.round(percentile(allOff, 0.95))} on ${Math.round(percentile(allOn, 0.5))}/${Math.round(percentile(allOn, 0.95))}`,
  );
  let changed = 0;
  let rewrittenControls = 0;
  for (const control of fixture.controls) {
    const before = off.controls.get(control.id) as Outcome;
    const after = on.controls.get(control.id) as Outcome;
    const same = before.top.join('|') === after.top.join('|');
    if (!same) changed += 1;
    if (after.rewrite) {
      rewrittenControls += 1;
      console.log(
        `control rewritten: ${control.id} «${control.query}» -> ${after.rewrite} (first group changed: ${before.top[0] !== after.top[0]})`,
      );
    }
  }
  console.log(
    `controls ${fixture.controls.length}: result changed ${changed}, rewritten ${rewrittenControls}; latency p50 off ${Math.round(
      percentile(
        [...off.controls.values()].map((o) => o.ms),
        0.5,
      ),
    )} on ${Math.round(
      percentile(
        [...on.controls.values()].map((o) => o.ms),
        0.5,
      ),
    )} ms`,
  );
  const misses = fixture.cases.filter((item) => (on.cases.get(item.id) as Outcome).rank < 0);
  console.log(`\nmisses with fallback on (${misses.length}):`);
  for (const item of misses.slice(0, Number(process.env['MISSES'] ?? 40)))
    console.log(
      `  ${item.id} «${item.query}» (${item.name}) rewrite=${(on.cases.get(item.id) as Outcome).rewrite ?? '-'}`,
    );
}
