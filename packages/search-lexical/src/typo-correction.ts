/**
 * Corpus-vocabulary typo-correction fallback (2026-09 RapidFuzz OSA port, see `rapidfuzz.ts`).
 *
 * Intent (per docs/state/branch-log-2026-09.md "RapidFuzz medication experiment" and
 * docs/AGENTS.md "Search expectations"): a *last-resort* fallback, tried only after the original
 * query has already been searched and returned nothing useful. It never runs speculatively and
 * never replaces the primary lexical/alias/medication-spelling matching in `analysis.ts` and
 * `medication-spelling.ts` — those already handle everything they can with source-backed
 * vocabulary and bounded edit distance. This module only steps in for a genuinely unknown word
 * against the installed corpus's own vocabulary (diagnoses, symptoms, drug names as they actually
 * appear in the indexed text), the same way a doctor's typo in "пиелонефрит" should still find
 * "пиелонефрит" even though that word is not a medication alias.
 *
 * The caller (an integration point in `@localmed/core`, not implemented here — see the package's
 * README/AGENTS notes on zone boundaries) is responsible for building the corpus vocabulary from
 * its own token stream (document titles, chunk text) at load time or as a small derived artifact,
 * calling `correctQueryAgainstVocabulary` only when the original query's results were empty, and
 * — if a correction was found — re-running search with `correctedQuery` and surfacing
 * `corrections` to the user (UI convention: «Показаны результаты по: {correctedQuery}»; see
 * `QueryCorrection` in `@localmed/contracts`).
 */
import type { QueryCorrection, QueryWordCorrection } from '@localmed/contracts';
import { extractTop } from './rapidfuzz';

const WORD_PATTERN = /[0-9a-zа-я]+/gu;

/** Below this length, a "typo" is indistinguishable from a different word — never corrected. */
export const MIN_TYPO_WORD_LENGTH = 5;
const MAX_TYPO_WORD_LENGTH = 40;
const DEFAULT_SCORE_CUTOFF = 0.72;
const DEFAULT_MAX_TERMS = 200_000;
const LENGTH_BUCKET_RADIUS = 2;

export interface CorpusVocabularyOptions {
  /** Terms occurring fewer times than this across the corpus are dropped. Default 1 (keep all). */
  readonly minFrequency?: number;
  /** Hard cap on distinct terms kept, by descending frequency, for a bounded memory footprint. */
  readonly maxTerms?: number;
}

/**
 * A corpus word list prepared for fast fuzzy lookup: grouped by length so a query word is only
 * compared against same-ish-length vocabulary terms (RapidFuzz OSA on a full flat scan of a
 * 50k-200k word vocabulary costs hundreds of milliseconds per query — see
 * tools/benchmarks/src/rapidfuzz-microbenchmark.ts — so this fallback, which by design only runs
 * when the original query already failed, still needs the length-bucketed candidate generation
 * the rest of this package uses (`medication-spelling.ts`, `aliases.ts`) to stay usable at all).
 */
export interface CorpusVocabulary {
  readonly size: number;
  /** Exposed for `buildCorpusVocabulary`'s memory-measurement benchmark and for tests. */
  readonly terms: ReadonlySet<string>;
  has(term: string): boolean;
  /** Candidate terms whose length is within `LENGTH_BUCKET_RADIUS` of `word.length`. */
  candidatesNear(word: string): readonly string[];
}

/**
 * Builds a `CorpusVocabulary` from a stream of already-tokenized, already-normalized corpus words
 * (e.g. `tokenize(normalizeSurfaceText(chunkText))` for every indexed chunk/title). Counting is
 * streamed (a single pass, one running `Map<string, number>`), so the caller does not need to
 * materialize the whole token stream at once.
 */
export function buildCorpusVocabulary(
  tokens: Iterable<string>,
  options: CorpusVocabularyOptions = {},
): CorpusVocabulary {
  const { minFrequency = 1, maxTerms = DEFAULT_MAX_TERMS } = options;
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < MIN_TYPO_WORD_LENGTH || token.length > MAX_TYPO_WORD_LENGTH) continue;
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  let kept = [...frequency.entries()].filter(([, count]) => count >= minFrequency);
  kept.sort((left, right) => right[1] - left[1]);
  if (kept.length > maxTerms) kept = kept.slice(0, maxTerms);

  const terms = new Set(kept.map(([term]) => term));
  const byLength = new Map<number, string[]>();
  for (const term of terms) {
    const bucket = byLength.get(term.length) ?? [];
    bucket.push(term);
    byLength.set(term.length, bucket);
  }

  return {
    size: terms.size,
    terms,
    has: (term) => terms.has(term),
    candidatesNear(word) {
      const candidates: string[] = [];
      for (
        let length = Math.max(MIN_TYPO_WORD_LENGTH, word.length - LENGTH_BUCKET_RADIUS);
        length <= word.length + LENGTH_BUCKET_RADIUS;
        length += 1
      ) {
        const bucket = byLength.get(length);
        if (bucket) candidates.push(...bucket);
      }
      return candidates;
    },
  };
}

export type { QueryCorrection, QueryWordCorrection };

export interface CorrectQueryOptions {
  /** RapidFuzz OSA `normalized_similarity` floor for accepting a correction. Default 0.72. */
  readonly scoreCutoff?: number;
}

/**
 * Corrects every word in `normalizedQuery` (already run through `normalizeSurfaceText`) that is
 * absent from `vocabulary`, replacing it with the closest vocabulary word at or above
 * `scoreCutoff`. Returns `null` when there is nothing to correct (every word is already in the
 * vocabulary, or no unknown word had a close-enough vocabulary match) — the caller should keep
 * the original (empty) result in that case, not treat `null` as an error.
 *
 * Only ever called by the caller when the *original* query's search already came back empty —
 * this function has no opinion on that; it just corrects words, unconditionally, whenever asked.
 */
export function correctQueryAgainstVocabulary(
  normalizedQuery: string,
  vocabulary: CorpusVocabulary,
  options: CorrectQueryOptions = {},
): QueryCorrection | null {
  const { scoreCutoff = DEFAULT_SCORE_CUTOFF } = options;
  const corrections: QueryWordCorrection[] = [];
  let rebuilt = '';
  let cursor = 0;
  for (const match of normalizedQuery.matchAll(WORD_PATTERN)) {
    const word = match[0];
    const start = match.index;
    if (
      word.length < MIN_TYPO_WORD_LENGTH ||
      word.length > MAX_TYPO_WORD_LENGTH ||
      vocabulary.has(word)
    ) {
      continue;
    }
    const candidates = vocabulary.candidatesNear(word);
    if (candidates.length === 0) continue;
    const [best] = extractTop(word, candidates, 1, { scoreCutoff });
    if (!best) continue;
    rebuilt += normalizedQuery.slice(cursor, start) + best.choice;
    cursor = start + word.length;
    corrections.push({ original: word, corrected: best.choice, score: best.score });
  }
  if (corrections.length === 0) return null;
  rebuilt += normalizedQuery.slice(cursor);
  return { correctedQuery: rebuilt, corrections };
}
