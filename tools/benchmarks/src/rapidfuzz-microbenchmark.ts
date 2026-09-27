#!/usr/bin/env bun
/**
 * Microbenchmark for the RapidFuzz port in packages/search-lexical/src/rapidfuzz.ts:
 * per-pair OSA/Levenshtein distance calls, and `extract`/`extractTop` over 50k/200k-word
 * vocabularies. RapidFuzz itself (MIT license, see rapidfuzz.ts header) is not a project
 * dependency; this only measures the ported TypeScript implementation.
 *
 * Run: bun tools/benchmarks/src/rapidfuzz-microbenchmark.ts
 */
import { extract, extractTop, Levenshtein, OSA } from '@localmed/search-lexical';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const CYRILLIC = 'абвгдежзийклмнопрстуфхцчшщъыьэюяе';

function randomWord(rng: () => number, minLength: number, maxLength: number): string {
  const length = minLength + Math.floor(rng() * (maxLength - minLength));
  let word = '';
  for (let i = 0; i < length; i += 1) {
    word += CYRILLIC[Math.floor(rng() * CYRILLIC.length)];
  }
  return word;
}

function buildVocabulary(size: number, seed: number): string[] {
  const rng = seededRandom(seed);
  return Array.from({ length: size }, () => randomWord(rng, 5, 14));
}

function timeMs<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

function benchPairwise(
  label: string,
  fn: (a: string, b: string) => number,
  pairs: [string, string][],
) {
  const { ms } = timeMs(() => {
    let checksum = 0;
    for (const [a, b] of pairs) checksum += fn(a, b);
    return checksum;
  });
  const perCallUs = (ms * 1000) / pairs.length;
  console.log(
    `  ${label}: ${pairs.length} pairs in ${ms.toFixed(2)}ms — ${perCallUs.toFixed(3)} us/pair`,
  );
}

function benchExtract(
  label: string,
  vocabularySize: number,
  queries: string[],
  vocabulary: string[],
  useTop: boolean,
  limit: number,
) {
  const { ms } = timeMs(() => {
    let checksum = 0;
    for (const query of queries) {
      const matches = useTop
        ? extractTop(query, vocabulary, limit, { scoreCutoff: 0.6 })
        : extract(query, vocabulary, { scoreCutoff: 0.6, limit });
      checksum += matches.length;
    }
    return checksum;
  });
  const perQueryMs = ms / queries.length;
  console.log(
    `  ${label} over ${vocabularySize.toLocaleString()} words: ${queries.length} queries in ${ms.toFixed(1)}ms — ${perQueryMs.toFixed(2)} ms/query`,
  );
}

function main() {
  console.log('RapidFuzz TS port microbenchmark (packages/search-lexical/src/rapidfuzz.ts)');
  console.log(
    `Runtime: ${process.versions['bun'] ? `Bun ${process.versions['bun']}` : process.version}\n`,
  );

  console.log('Per-pair distance (short medication-length strings, <=64 units):');
  const pairRng = seededRandom(42);
  const shortPairs: [string, string][] = Array.from({ length: 20000 }, () => [
    randomWord(pairRng, 6, 14),
    randomWord(pairRng, 6, 14),
  ]);
  benchPairwise('OSA.distance', (a, b) => OSA.distance(a, b), shortPairs);
  benchPairwise('OSA.normalizedSimilarity', (a, b) => OSA.normalizedSimilarity(a, b), shortPairs);
  benchPairwise('Levenshtein.distance', (a, b) => Levenshtein.distance(a, b), shortPairs);
  benchPairwise(
    'Levenshtein.normalizedSimilarity',
    (a, b) => Levenshtein.normalizedSimilarity(a, b),
    shortPairs,
  );

  console.log('\nPer-pair distance (long strings, >64 units, DP fallback):');
  const longRng = seededRandom(43);
  const longPairs: [string, string][] = Array.from({ length: 2000 }, () => [
    randomWord(longRng, 80, 140),
    randomWord(longRng, 80, 140),
  ]);
  benchPairwise('OSA.distance (DP fallback)', (a, b) => OSA.distance(a, b), longPairs);
  benchPairwise(
    'Levenshtein.distance (DP fallback)',
    (a, b) => Levenshtein.distance(a, b),
    longPairs,
  );

  for (const vocabularySize of [50_000, 200_000]) {
    console.log(`\nextract/extractTop over a ${vocabularySize.toLocaleString()}-word vocabulary:`);
    const vocabulary = buildVocabulary(vocabularySize, 7);
    const queryRng = seededRandom(99);
    const queries = Array.from({ length: 20 }, () => {
      const base = vocabulary[Math.floor(queryRng() * vocabulary.length)] as string;
      // Mutate one character to make it a near-miss, like a real typo query.
      const position = Math.floor(queryRng() * base.length);
      return `${base.slice(0, position)}${CYRILLIC[Math.floor(queryRng() * CYRILLIC.length)]}${base.slice(position + 1)}`;
    });
    benchExtract('extract (limit 8)', vocabularySize, queries, vocabulary, false, 8);
    benchExtract('extractTop (limit 8)', vocabularySize, queries, vocabulary, true, 8);
  }
}

main();
