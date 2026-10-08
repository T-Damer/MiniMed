// Sense ranking over a built dictionary edition: for every headword with two or more defined
// senses, which sense does the card show first? Reports the share of headwords whose first sense
// differs from the old order (explicit definition before gloss, then identifier) and checks the
// authored cases in `tools/benchmarks/sense-queries.json` («Депрессия» must lead with the mood
// disorder, not the fracture pattern of one traumatology recommendation).
//
// Run: `bun tools/benchmarks/src/run-sense-ranking.ts --db=<edition .db> [--report=<json>]`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { DefinitionReferenceSense } from '@localmed/contracts';

import { rankSenses } from '../../../apps/app/src/features/reference/sense-ranking';
import { senseCaseVerdict } from './sense-ranking-cases';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args)
  if (!/^--(?:db|report)=.+$/u.test(arg)) throw new Error('Unknown argument.');
const databasePath = option('db');
if (!databasePath) throw new Error('Pass --db=<edition .db>.');

interface Row {
  readonly id: string;
  readonly title: string;
  readonly coverage: string;
  readonly normalized: string;
  readonly sense: DefinitionReferenceSense | undefined;
  readonly text: string;
}

const sqlite = (await import('bun:sqlite' as string)) as unknown as {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => {
    query(sql: string): { all(): unknown[] };
    close(): void;
  };
};
const database = new sqlite.Database(resolve(root, databasePath), { readonly: true });
const rows = (
  database
    .query(
      `SELECT e.id AS id, e.canonical_name AS title, e.normalized_name AS normalized,
        json_extract(e.metadata_json, '$.coverage') AS coverage,
        json_extract(e.metadata_json, '$.sense') AS sense,
        (SELECT c.original_text FROM definition_reference_links l JOIN chunks c ON c.id = l.chunk_id
          WHERE l.entity_id = e.id AND l.link_type = 'reference:definition' ORDER BY l.id LIMIT 1) AS text
      FROM knowledge_entities e
      WHERE json_extract(e.metadata_json, '$.coverage') IN ('explicit-definition', 'definition', 'gloss')
        AND e.entity_type <> 'abbreviation' ORDER BY e.id`,
    )
    .all() as Record<string, unknown>[]
).flatMap((row): Row[] =>
  typeof row['text'] === 'string'
    ? [
        {
          id: String(row['id']),
          title: String(row['title']),
          coverage: String(row['coverage']),
          normalized: String(row['normalized']),
          sense: typeof row['sense'] === 'string' ? JSON.parse(row['sense']) : undefined,
          text: row['text'],
        },
      ]
    : [],
);
database.close();

const coverageRank: Record<string, number> = { 'explicit-definition': 0, definition: 1, gloss: 2 };
const groups = new Map<string, Row[]>();
for (const row of rows) groups.set(row.normalized, [...(groups.get(row.normalized) ?? []), row]);

const firstSense = (members: readonly Row[], ranked: boolean): Row => {
  const candidates = members.map((member, order) => ({ item: member, sense: member.sense, order }));
  if (ranked) return rankSenses(candidates)[0]?.item as Row;
  return [...candidates].sort(
    (left, right) =>
      (coverageRank[left.item.coverage] ?? 5) - (coverageRank[right.item.coverage] ?? 5) ||
      left.order - right.order,
  )[0]?.item as Row;
};

let ambiguous = 0;
let changed = 0;
for (const members of groups.values()) {
  if (new Set(members.map((member) => member.text)).size < 2) continue;
  ambiguous += 1;
  if (firstSense(members, true).id !== firstSense(members, false).id) changed += 1;
}

const cases = (
  JSON.parse(readFileSync(resolve(root, 'tools/benchmarks/sense-queries.json'), 'utf8')) as {
    id: string;
    headword: string;
    definitionIncludes: string;
    definitionExcludes?: string;
  }[]
).map((fixture) => {
  const members = groups.get(fixture.headword.toLowerCase().replaceAll('ё', 'е')) ?? [];
  const before = members.length ? firstSense(members, false) : undefined;
  const after = members.length ? firstSense(members, true) : undefined;
  return {
    id: fixture.id,
    headword: fixture.headword,
    senses: members.length,
    before: before && {
      field: before.sense?.fieldLabel ?? null,
      text: before.text.slice(0, 90),
      passes: senseCaseVerdict(fixture, before.text),
    },
    after: after && {
      field: after.sense?.fieldLabel ?? null,
      text: after.text.slice(0, 90),
      passes: senseCaseVerdict(fixture, after.text),
    },
  };
});

const report = {
  database: databasePath,
  definedSenses: rows.length,
  headwords: groups.size,
  ambiguousHeadwords: ambiguous,
  firstSenseChangedByRanking: changed,
  cases: {
    total: cases.length,
    passedBefore: cases.filter((item) => item.before?.passes).length,
    passedAfter: cases.filter((item) => item.after?.passes).length,
    rows: cases,
  },
  note: 'Authored probes and one owner report, not independent clinical qualification.',
};
const output = option('report');
if (output) {
  mkdirSync(dirname(resolve(root, output)), { recursive: true });
  writeFileSync(resolve(root, output), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (report.cases.passedAfter < report.cases.total) process.exitCode = 1;
