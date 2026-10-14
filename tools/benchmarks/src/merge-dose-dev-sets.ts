// RX2: merges the development draws (each judged by hand with the gate and parser as they were at
// the time) into tools/benchmarks/dose-rule-gate-dev.json, the sample the gate classes are measured
// on. A rule the parser has changed since it was judged is re-judged: `--rejudged=<file>` lists such
// rules as `<rule id> | correct|incomplete|wrong | reason` lines.
//
//   bun tools/benchmarks/src/merge-dose-dev-sets.ts --out=<file> --rejudged=<file> [--name=dev|blind] [--note=...] <set.json>...
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';

import { isRejectedShape, shapeOf } from '../../../apps/app/src/features/prescription/dose-gate';
import { loadIndex } from './dose-rule-frame';

const args = process.argv.slice(2);
const argument = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = argument('out');
const rejudgedFile = argument('rejudged');
const inputs = args.filter((arg) => !arg.startsWith('--'));
if (!out || inputs.length === 0) throw new Error('Usage: see the header of merge-dose-dev-sets.ts');

interface Item {
  id: string;
  documentId: string;
  rule: DoseRule;
  verdict: 'correct' | 'incomplete' | 'wrong';
  reason: string;
  [key: string]: unknown;
}

const rejudged = new Map<string, { verdict: string; reason: string }>();
if (rejudgedFile) {
  for (const line of readFileSync(resolve(rejudgedFile), 'utf8').split('\n')) {
    const match = /^(\S+)\s*\|\s*(correct|incomplete|wrong)\s*\|\s*(.*)$/u.exec(line);
    if (match)
      rejudged.set(match[1] as string, { verdict: match[2] as string, reason: match[3] as string });
  }
}

const index = loadIndex();
const items: Item[] = [];
const draws: { seed: string; items: number; drawnFrom: unknown }[] = [];
const seen = new Set<string>();
for (const file of inputs) {
  const set = JSON.parse(readFileSync(resolve(file), 'utf8')) as {
    seed: string;
    drawnFrom: unknown;
    items: Item[];
  };
  draws.push({ seed: set.seed, items: set.items.length, drawnFrom: set.drawnFrom });
  for (const item of set.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const document = index.asset.documents[item.documentId];
    const current = document?.rules.find(
      (rule) => `${item.documentId}#${rule.s}:${rule.a}:${rule.k}` === item.id,
    );
    const { gc: _now, ...nowRule } = (current ?? {}) as DoseRule;
    const { gc: _then, ...thenRule } = item.rule;
    const changed = current === undefined || JSON.stringify(nowRule) !== JSON.stringify(thenRule);
    const extra: Record<string, unknown> = {};
    if (current && changed && !isRejectedShape(shapeOf(current))) {
      const again = rejudged.get(item.id);
      if (!again)
        throw new Error(`${item.id} changed since it was judged and passes the gate: re-judge it`);
      extra['rejudged'] = { rule: current, verdict: again.verdict, reason: again.reason };
    }
    items.push({ ...item, shape: current ? shapeOf(current) : 'vanished', ...extra });
  }
}
writeFileSync(
  resolve(out),
  `${JSON.stringify({ name: argument('name') ?? 'dev', note: argument('note') ?? '', draws, items }, null, 1)}\n`,
);
console.log(`${items.length} development rules from ${draws.length} draws`);
