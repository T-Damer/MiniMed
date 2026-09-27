#!/usr/bin/env bun
/**
 * Measures the corpus-vocabulary typo-correction fallback
 * (packages/search-lexical/src/typo-correction.ts) against the real indexed corpus:
 *   - builds a `CorpusVocabulary` from every chunk's `normalized_text` in a core database
 *     (default apps/app/public/content/core.db, the same default `benchmark:lookup-quality` uses)
 *     and reports its size and approximate memory footprint;
 *   - runs the curated realistic misspellings in tools/benchmarks/typo-correction-queries.json
 *     (diagnoses, symptoms, drug names, plus a few negative controls);
 *   - runs a larger deterministic statistical set (character-level mutations of real, frequent
 *     corpus words) and reports recovery rate by mutation family.
 *
 * This measures the standalone corrector only, not an end-to-end search re-query — wiring
 * "original query returned nothing -> correct -> re-run search" into `@localmed/core`'s `search()`
 * method and the `MedicalStore` port is a separate, larger change outside this package's zone (it
 * touches the storage port and every store implementation); see the handback notes for this task.
 *
 * Usage: bun tools/benchmarks/src/run-typo-correction.ts [--db=<path to a core .db>]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCorpusVocabulary,
  correctQueryAgainstVocabulary,
  tokenize,
} from '@localmed/search-lexical';

// tools/benchmarks has no bun-types (tsconfig.json restricts `types` to `node`); load bun:sqlite
// through a plain dynamic import with a string-cast specifier, as bun-sqlite-medical-store.ts does.
interface BunSqliteQuery {
  iterate(...parameters: unknown[]): IterableIterator<unknown>;
}
interface BunSqliteDatabase {
  query(sql: string): BunSqliteQuery;
  close(): void;
}
interface BunSqliteModule {
  Database: new (path: string, options?: { readonly?: boolean }) => BunSqliteDatabase;
}
const { Database } = (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;

const root = resolve(import.meta.dirname, '../../..');
const dbArg = process.argv.find((arg) => arg.startsWith('--db='))?.slice(5);
const dbPath = resolve(root, dbArg ?? 'apps/app/public/content/core.db');

interface TypoCase {
  readonly id: string;
  readonly query: string;
  readonly target: string | null;
}

function loadCases(): readonly TypoCase[] {
  const path = resolve(root, 'tools/benchmarks/typo-correction-queries.json');
  const payload = JSON.parse(readFileSync(path, 'utf-8')) as { cases: readonly TypoCase[] };
  return payload.cases;
}

function* chunkWords(db: BunSqliteDatabase): Generator<string> {
  const query = db.query('SELECT normalized_text FROM chunks');
  for (const row of query.iterate() as IterableIterator<{ normalized_text: string }>) {
    yield* tokenize(row.normalized_text);
  }
}

function approximateBytes(terms: ReadonlySet<string>): number {
  // Rough lower bound: 2 bytes/UTF-16 code unit for the string content plus a fixed per-entry
  // overhead estimate for the Set/Map slots and string object headers (V8/JSC ballpark, not exact).
  let chars = 0;
  for (const term of terms) chars += term.length;
  const perEntryOverhead = 60;
  return chars * 2 + terms.size * perEntryOverhead;
}

function heapUsedMb(): number {
  // No forced GC here (Bun's global is deliberately avoided for typecheck reasons — see the
  // bun:sqlite import above — and Node needs --expose-gc for `global.gc`), so this is a rough,
  // GC-timing-dependent estimate; `approximateBytes` below is the more reliable figure.
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

const CONFUSIONS: readonly [string, string][] = [
  ['и', 'е'],
  ['е', 'о'],
  ['а', 'о'],
  ['д', 'т'],
  ['з', 'с'],
];

function mutate(word: string, family: string, seed: number): string | null {
  const chars = [...word];
  const at = seed % Math.max(1, chars.length - 1);
  switch (family) {
    case 'internal-swap': {
      const i = Math.max(1, Math.min(at, chars.length - 2));
      [chars[i], chars[i + 1]] = [chars[i + 1] as string, chars[i] as string];
      return chars.join('');
    }
    case 'final-delete':
      chars.pop();
      return chars.join('');
    case 'final-double':
      chars.push(chars[chars.length - 1] as string);
      return chars.join('');
    case 'confusion': {
      for (let i = 0; i < chars.length; i += 1) {
        for (const [left, right] of CONFUSIONS) {
          if (chars[i] === left) {
            chars[i] = right;
            return chars.join('');
          }
          if (chars[i] === right) {
            chars[i] = left;
            return chars.join('');
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function main() {
  console.log(`Building corpus vocabulary from ${dbPath} ...`);
  const db = new Database(dbPath, { readonly: true });
  const before = heapUsedMb();
  const started = performance.now();
  const vocabulary = buildCorpusVocabulary(chunkWords(db));
  const buildMs = performance.now() - started;
  const after = heapUsedMb();
  db.close();

  console.log(
    `Vocabulary: ${vocabulary.size.toLocaleString()} distinct terms, built in ${buildMs.toFixed(0)}ms`,
  );
  console.log(
    `Memory: approx ${(approximateBytes(vocabulary.terms) / (1024 * 1024)).toFixed(2)}MB (string-size estimate), ` +
      `heapUsed delta ${(after - before).toFixed(2)}MB (process.memoryUsage, post-GC)`,
  );

  console.log('\nCurated realistic misspellings (diagnoses, symptoms, drug names):');
  const cases = loadCases();
  let correct = 0;
  let wronglyTriggered = 0;
  for (const testCase of cases) {
    const result = correctQueryAgainstVocabulary(testCase.query, vocabulary);
    const correctedWords = result?.corrections.map((c) => c.corrected) ?? [];
    if (testCase.target === null) {
      if (result) wronglyTriggered += 1;
      continue;
    }
    const before2 = vocabulary.has(testCase.target) ? 'in-vocab' : 'NOT-in-vocab(!)';
    const hit = correctedWords.includes(testCase.target);
    if (hit) correct += 1;
    console.log(
      `  [${hit ? 'OK  ' : 'MISS'}] ${testCase.id}: "${testCase.query}" -> target "${testCase.target}" (${before2}), got [${correctedWords.join(', ') || '(none)'}]`,
    );
  }
  const positives = cases.filter((c) => c.target !== null).length;
  const negatives = cases.length - positives;
  console.log(`\nCurated set: ${correct}/${positives} corrected to the expected word.`);
  console.log(
    `Negative controls: ${negatives - wronglyTriggered}/${negatives} correctly left uncorrected.`,
  );

  console.log('\nStatistical set: deterministic mutations of real, frequent corpus words:');
  const frequent = [...vocabulary.terms]
    .filter((term) => /^[а-я]+$/u.test(term) && term.length >= 7 && term.length <= 16)
    .toSorted((left, right) => left.localeCompare(right, 'ru'))
    .slice(0, 400);
  const families = ['internal-swap', 'final-delete', 'final-double', 'confusion'];
  for (const family of families) {
    let total = 0;
    let recovered = 0;
    frequent.forEach((word, index) => {
      const query = mutate(word, family, index * 7 + word.length);
      if (!query || query === word || vocabulary.has(query)) return;
      total += 1;
      const result = correctQueryAgainstVocabulary(query, vocabulary);
      if (result?.corrections.some((c) => c.corrected === word)) recovered += 1;
    });
    console.log(`  ${family}: ${recovered}/${total} recovered`);
  }
}

main();
