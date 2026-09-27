#!/usr/bin/env bun
/**
 * Measures the medication-spelling matcher (packages/search-lexical/src/medication-spelling.ts)
 * — weighted-OSA primary matcher, then the RapidFuzz OSA fallback added per the 2026-09-24
 * experiment (docs/research/rapidfuzz-medication-experiment-2026-09-24.md) — against:
 *   - the experiment's 929-case set (existing 162-case regression set + deterministic corpus
 *     mutations): Top-1/Top-8 recall;
 *   - the 300 exact-name controls: must never be "corrected";
 *   - the 10 negative (non-medication) controls: must never produce a candidate.
 *
 * Usage:
 *   bun tools/benchmarks/src/run-rapidfuzz-medication-fallback.ts \
 *     --db=../../data/build/core-knowledge.db \
 *     --cases=<path to `rapidfuzz-medication-experiment.py generate` output>
 */
import { readFileSync } from 'node:fs';
import type { AliasRecord } from '@localmed/domain';
import { createMedicationSpellingMatcher } from '@localmed/search-lexical';

// tools/benchmarks has no bun-types (tsconfig.json restricts `types` to `node`); load bun:sqlite
// through a plain dynamic import with a string-cast specifier, as bun-sqlite-medical-store.ts does.
interface BunSqliteDatabase {
  query(sql: string): { all(...parameters: unknown[]): readonly unknown[] };
  close(): void;
}
interface BunSqliteModule {
  Database: new (path: string, options?: { readonly?: boolean }) => BunSqliteDatabase;
}
const { Database } = (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;

interface Args {
  readonly db: string;
  readonly cases: string;
}

function parseArgs(): Args {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match?.[1] && match[2] !== undefined) args.set(match[1], match[2]);
  }
  const db = args.get('db');
  const cases = args.get('cases');
  if (!db || !cases) {
    throw new Error('usage: run-rapidfuzz-medication-fallback.ts --db=<path> --cases=<path>');
  }
  return { db, cases };
}

interface ExperimentCase {
  readonly id: string;
  readonly family: string;
  readonly query: string;
  readonly target: string;
}

interface ExperimentCases {
  readonly cases: readonly ExperimentCase[];
  readonly exactControls: readonly string[];
  readonly negativeControls: readonly string[];
}

function loadMedicationAliases(dbPath: string): AliasRecord[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query(
        "SELECT id, canonical_term as canonicalTerm, alias, category, weight FROM aliases WHERE category = 'medication'",
      )
      .all() as AliasRecord[];
    return rows;
  } finally {
    db.close();
  }
}

function summarize(
  label: string,
  cases: readonly ExperimentCase[],
  match: ReturnType<typeof createMedicationSpellingMatcher>,
) {
  let top1 = 0;
  let top8 = 0;
  const byFamily = new Map<string, { total: number; top1: number; top8: number }>();
  for (const testCase of cases) {
    const candidates = match(testCase.query);
    // targets are already normalizeSurfaceText'd (lowercase); compare case-insensitively.
    const rankIndex = candidates.findIndex((c) => c.name.toLowerCase() === testCase.target);
    const found = rankIndex >= 0;
    const bucket = byFamily.get(testCase.family) ?? { total: 0, top1: 0, top8: 0 };
    bucket.total += 1;
    if (rankIndex === 0) bucket.top1 += 1;
    if (found) bucket.top8 += 1;
    byFamily.set(testCase.family, bucket);
    if (rankIndex === 0) top1 += 1;
    if (found) top8 += 1;
  }
  console.log(`\n${label}: ${cases.length} cases`);
  console.log(`  top1=${top1}/${cases.length}  top8=${top8}/${cases.length}`);
  for (const [family, bucket] of [...byFamily.entries()].sort()) {
    console.log(
      `    ${family}: top1=${bucket.top1}/${bucket.total} top8=${bucket.top8}/${bucket.total}`,
    );
  }
}

function main() {
  const args = parseArgs();
  const aliases = loadMedicationAliases(args.db);
  console.log(`Loaded ${aliases.length} medication aliases from ${args.db}`);
  const payload = JSON.parse(readFileSync(args.cases, 'utf-8')) as ExperimentCases;

  const match = createMedicationSpellingMatcher(aliases);

  summarize('All 929 cases', payload.cases, match);
  summarize(
    'Prior 162-case regression subset',
    payload.cases.filter((c) => c.family === 'prior-162'),
    match,
  );

  let exactUnchanged = 0;
  for (const name of payload.exactControls) {
    if (match(name).length === 0) exactUnchanged += 1;
  }
  console.log(
    `\nExact-name controls: ${exactUnchanged}/${payload.exactControls.length} left unchanged`,
  );

  let negativesClean = 0;
  for (const query of payload.negativeControls) {
    if (match(query).length === 0) negativesClean += 1;
  }
  console.log(
    `Negative controls: ${negativesClean}/${payload.negativeControls.length} produced no candidate`,
  );
}

main();
