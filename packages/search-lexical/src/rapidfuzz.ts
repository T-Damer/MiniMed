/**
 * A TypeScript port of two RapidFuzz (https://github.com/rapidfuzz/RapidFuzz) distance metrics —
 * Levenshtein and OSA (Optimal String Alignment, aka restricted Damerau-Levenshtein) — plus the
 * `process.extract`/`extractTop` choice-list helpers built on top of them.
 *
 * RapidFuzz is MIT licensed:
 *   Copyright (c) 2011 Adam Cohen (original fuzzywuzzy), Copyright (c) 2021 Max Bachmann
 *   (RapidFuzz). See NOTICE for the full license text.
 *
 * This is not a full RapidFuzz port: only the pieces MiniMed's medication/typo fallbacks need.
 * Distances are unweighted (insert = delete = substitute = transpose = 1), matching
 * `rapidfuzz.distance.Levenshtein`/`rapidfuzz.distance.OSA` at their default weights.
 *
 * Two implementations exist for each metric:
 *  - a bit-parallel one (Myers 1999 for Levenshtein; Hyyrö 2003 for OSA), operating on 64-bit
 *    words, used whenever both strings are at most 64 UTF-16 code units long;
 *  - a row-wise dynamic-programming fallback (correct for any length), used otherwise and also
 *    used as the source of truth that the bit-parallel path is checked against in tests.
 *
 * Callers should pass the same normalized strings the rest of MiniMed's search uses (ё→е etc,
 * see `normalizeSurfaceText`); nothing here does Unicode normalization of its own.
 */

const WORD_BITS = 64;
const U64_MASK = (1n << 64n) - 1n;

function u64(value: bigint): bigint {
  return value & U64_MASK;
}

/** Bitmask of positions (bit i = character at index i) for every distinct character in `value`. */
function buildPeq(value: string): Map<string, bigint> {
  const peq = new Map<string, bigint>();
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;
    peq.set(char, (peq.get(char) ?? 0n) | (1n << BigInt(i)));
  }
  return peq;
}

/**
 * A pattern (the shorter, <=64-code-unit side) pre-processed once so it can be compared against
 * many "text" strings without rebuilding its character bitmasks each time — the shape `extract`/
 * `extractTop` need when scanning a large, fixed choice list for a single query.
 */
export interface PreparedPattern {
  readonly length: number;
  readonly peq: ReadonlyMap<string, bigint>;
  readonly vp0: bigint;
  readonly mask: bigint;
}

/** Pre-processes `pattern` (must be <=64 UTF-16 code units) for repeated bit-parallel comparisons. */
export function preparePattern(pattern: string): PreparedPattern {
  const m = pattern.length;
  return {
    length: m,
    peq: buildPeq(pattern),
    vp0: m === 0 ? 0n : m === WORD_BITS ? U64_MASK : (1n << BigInt(m)) - 1n,
    mask: m === 0 ? 0n : 1n << BigInt(m - 1),
  };
}

/**
 * Bit-parallel Levenshtein distance (Myers 1999), pattern (`left`) up to 64 UTF-16 code units.
 * `right` (the "text") can be any length; only `left` needs to fit in one machine word.
 */
function levenshteinBitParallel(left: string, right: string): number {
  return levenshteinBitParallelPrepared(preparePattern(left), right);
}

function levenshteinBitParallelPrepared(prepared: PreparedPattern, right: string): number {
  const m = prepared.length;
  if (m === 0) return right.length;
  const peq = prepared.peq;
  let vp = prepared.vp0;
  let vn = 0n;
  let score = BigInt(m);
  const mask = prepared.mask;
  for (let j = 0; j < right.length; j += 1) {
    const eq = peq.get(right[j] as string) ?? 0n;
    const xv = eq | vn;
    const xh = u64(u64(u64(eq & vp) + vp) ^ vp) | eq;
    let ph = vn | u64(~(xh | vp));
    let mh = vp & xh;
    if (ph & mask) score += 1n;
    if (mh & mask) score -= 1n;
    ph = u64((ph << 1n) | 1n);
    mh = u64(mh << 1n);
    vp = u64(mh | u64(~(xv | ph)));
    vn = ph & xv;
  }
  return Number(score);
}

/** Row-wise Levenshtein DP; the correctness oracle and the fallback for strings over 64 units. */
function levenshteinDp(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const previous = new Uint32Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  const current = new Uint32Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    const leftChar = left[i - 1];
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = leftChar === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      );
    }
    previous.set(current);
  }
  return previous[right.length] ?? 0;
}

/**
 * Bit-parallel OSA distance (Hyyrö 2003 bit-vector algorithm for the restricted
 * Damerau-Levenshtein / "optimal string alignment" distance — insert, delete, substitute,
 * adjacent-transposition, each cost 1, no substring edited more than once).
 * Pattern (`left`) up to 64 UTF-16 code units; `right` (the "text") can be any length.
 */
function osaBitParallel(left: string, right: string): number {
  return osaBitParallelPrepared(preparePattern(left), right);
}

function osaBitParallelPrepared(prepared: PreparedPattern, right: string): number {
  const m = prepared.length;
  if (m === 0) return right.length;
  const peq = prepared.peq;
  let vp = prepared.vp0;
  let vn = 0n;
  let d0 = 0n;
  let peqPreviousChar = 0n;
  let score = BigInt(m);
  const mask = prepared.mask;
  for (let j = 0; j < right.length; j += 1) {
    const peqChar = peq.get(right[j] as string) ?? 0n;
    const transposed = u64(u64(u64(~d0) & peqChar) << 1n) & peqPreviousChar;
    let d0h = u64(u64(u64(peqChar & vp) + vp) ^ vp) | peqChar | vn;
    d0h = u64(d0h | transposed);
    let ph = vn | u64(~(d0h | vp));
    let mh = d0h & vp;
    if (ph & mask) score += 1n;
    if (mh & mask) score -= 1n;
    ph = u64((ph << 1n) | 1n);
    mh = u64(mh << 1n);
    vp = u64(mh | u64(~(d0h | ph)));
    vn = ph & d0h;
    d0 = d0h;
    peqPreviousChar = peqChar;
  }
  return Number(score);
}

/** Row-wise OSA DP; the correctness oracle and the fallback for strings over 64 units. */
function osaDp(left: string, right: string): number {
  if (left === right) return 0;
  const m = left.length;
  const n = right.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const twoBack = new Uint32Array(n + 1);
  const oneBack = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j += 1) oneBack[j] = j;
  const current = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    current[0] = i;
    const leftChar = left[i - 1];
    for (let j = 1; j <= n; j += 1) {
      const substitutionCost = leftChar === right[j - 1] ? 0 : 1;
      let value = Math.min(
        (oneBack[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (oneBack[j - 1] ?? 0) + substitutionCost,
      );
      if (i > 1 && j > 1 && leftChar === right[j - 2] && left[i - 2] === right[j - 1]) {
        value = Math.min(value, (twoBack[j - 2] ?? 0) + 1);
      }
      current[j] = value;
    }
    twoBack.set(oneBack);
    oneBack.set(current);
  }
  return oneBack[n] ?? 0;
}

export interface DistanceOptions {
  /**
   * As in RapidFuzz: when the true distance exceeds this, the returned value is only guaranteed
   * to be `scoreCutoff + 1` (an upper bound), not the exact distance. Both implementations here
   * compute the exact distance regardless (no early-exit optimization), so this only matters if a
   * caller wants to mirror RapidFuzz's "beyond cutoff" contract; it never makes the result wrong.
   */
  readonly scoreCutoff?: number;
}

export interface SimilarityOptions {
  readonly scoreCutoff?: number;
}

function dispatch(
  left: string,
  right: string,
  bitParallel: (a: string, b: string) => number,
  dp: (a: string, b: string) => number,
): number {
  if (left.length <= WORD_BITS) return bitParallel(left, right);
  if (right.length <= WORD_BITS) return bitParallel(right, left);
  return dp(left, right);
}

export const Levenshtein = {
  /** Exact edit distance (insert/delete/substitute, each cost 1). */
  distance(left: string, right: string, _options?: DistanceOptions): number {
    return dispatch(left, right, levenshteinBitParallel, levenshteinDp);
  },
  normalizedDistance(left: string, right: string, options?: SimilarityOptions): number {
    return normalizedDistanceOf(Levenshtein.distance(left, right), left, right, options);
  },
  similarity(left: string, right: string, options?: DistanceOptions): number {
    const maxLength = Math.max(left.length, right.length);
    return maxLength - Levenshtein.distance(left, right, options);
  },
  /** RapidFuzz `normalized_similarity`: `1 - distance / max(len(left), len(right))`, in `[0, 1]`. */
  normalizedSimilarity(left: string, right: string, options?: SimilarityOptions): number {
    return 1 - Levenshtein.normalizedDistance(left, right, options);
  },
} as const;

export const OSA = {
  /** Exact OSA distance (insert/delete/substitute/adjacent-transpose, each cost 1). */
  distance(left: string, right: string, _options?: DistanceOptions): number {
    return dispatch(left, right, osaBitParallel, osaDp);
  },
  normalizedDistance(left: string, right: string, options?: SimilarityOptions): number {
    return normalizedDistanceOf(OSA.distance(left, right), left, right, options);
  },
  similarity(left: string, right: string, options?: DistanceOptions): number {
    const maxLength = Math.max(left.length, right.length);
    return maxLength - OSA.distance(left, right, options);
  },
  /** RapidFuzz `normalized_similarity`: `1 - distance / max(len(left), len(right))`, in `[0, 1]`. */
  normalizedSimilarity(left: string, right: string, options?: SimilarityOptions): number {
    return 1 - OSA.normalizedDistance(left, right, options);
  },
} as const;

function normalizedDistanceOf(
  distance: number,
  left: string,
  right: string,
  _options?: SimilarityOptions,
): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 0;
  return distance / maxLength;
}

// Exposed for the parity test suite, which checks the bit-parallel fast path against the DP
// oracle directly (in addition to both against RapidFuzz's own Python values).
export const internal = {
  levenshteinBitParallel,
  levenshteinDp,
  osaBitParallel,
  osaDp,
};

/**
 * `extract`/`extractTop` compare one fixed `query` against many `choices`. Rebuilding the query's
 * character bitmasks (`preparePattern`) on every single comparison — which calling `OSA.distance`
 * or `Levenshtein.distance` per pair would do — dominates the cost at vocabulary scale. When the
 * scorer is one of the two built-in ones and `query` fits in one machine word (<=64 units, true
 * for essentially every medication/vocabulary word), prepare it once and reuse it for every choice.
 * Falls back to calling `scorer` per pair for a custom scorer or an over-length query.
 */
function resolveFastScorer(
  query: string,
  scorer: (query: string, choice: string) => number,
): (text: string) => number {
  if (query.length <= WORD_BITS && scorer === OSA.normalizedSimilarity) {
    const prepared = preparePattern(query);
    return (text: string) => {
      const distance = osaBitParallelPrepared(prepared, text);
      const maxLength = Math.max(prepared.length, text.length);
      return maxLength === 0 ? 1 : 1 - distance / maxLength;
    };
  }
  if (query.length <= WORD_BITS && scorer === Levenshtein.normalizedSimilarity) {
    const prepared = preparePattern(query);
    return (text: string) => {
      const distance = levenshteinBitParallelPrepared(prepared, text);
      const maxLength = Math.max(prepared.length, text.length);
      return maxLength === 0 ? 1 : 1 - distance / maxLength;
    };
  }
  return (text: string) => scorer(query, text);
}

export interface ExtractMatch<T> {
  readonly choice: T;
  readonly score: number;
  readonly index: number;
}

export interface ExtractOptions<T> {
  /** Defaults to `OSA.normalizedSimilarity`. Higher must mean more similar. */
  readonly scorer?: (query: string, choice: string) => number;
  /** Extracts the comparable string from a choice; identity when choices are already strings. */
  readonly processor?: (choice: T) => string;
  /** Matches below this score are dropped. Default 0 (keep everything). */
  readonly scoreCutoff?: number;
  readonly limit?: number;
}

/**
 * RapidFuzz `process.extract`: scores every choice, drops anything below `scoreCutoff`, and
 * returns the rest sorted by descending score (ties broken by original index, for determinism).
 */
export function extract<T>(
  query: string,
  choices: readonly T[],
  options: ExtractOptions<T> = {},
): ExtractMatch<T>[] {
  const { scorer = OSA.normalizedSimilarity, processor, scoreCutoff = 0, limit } = options;
  const score = resolveFastScorer(query, scorer);
  const matches: ExtractMatch<T>[] = [];
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index] as T;
    const text = processor ? processor(choice) : (choice as unknown as string);
    const value = score(text);
    if (value >= scoreCutoff) matches.push({ choice, score: value, index });
  }
  matches.sort((a, b) => b.score - a.score || a.index - b.index);
  return limit === undefined ? matches : matches.slice(0, limit);
}

/**
 * Like `extract`, but keeps only a bounded min-heap of size `limit` instead of collecting and
 * sorting every match — the shape RapidFuzz's `process.extract(..., limit=k)` uses internally.
 * Prefer this over `extract` when `choices` is large (tens of thousands) and `limit` is small.
 */
export function extractTop<T>(
  query: string,
  choices: readonly T[],
  limit: number,
  options: Omit<ExtractOptions<T>, 'limit'> = {},
): ExtractMatch<T>[] {
  if (limit <= 0) return [];
  const { scorer = OSA.normalizedSimilarity, processor, scoreCutoff = 0 } = options;
  const score = resolveFastScorer(query, scorer);
  // Min-heap ordered so the *weakest* kept match — lowest score, ties broken by highest index —
  // is always at the root: that is the one a better candidate should evict.
  const heap: ExtractMatch<T>[] = [];
  const isWorse = (a: ExtractMatch<T>, b: ExtractMatch<T>): boolean =>
    a.score < b.score || (a.score === b.score && a.index > b.index);
  const siftUp = (start: number) => {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      // Root must hold the worst entry: bubble a worse-than-its-parent node upward.
      if (!isWorse(heap[i] as ExtractMatch<T>, heap[parent] as ExtractMatch<T>)) break;
      [heap[parent], heap[i]] = [heap[i] as ExtractMatch<T>, heap[parent] as ExtractMatch<T>];
      i = parent;
    }
  };
  const siftDown = (start: number) => {
    let i = start;
    for (;;) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let worst = i;
      if (
        left < heap.length &&
        isWorse(heap[left] as ExtractMatch<T>, heap[worst] as ExtractMatch<T>)
      )
        worst = left;
      if (
        right < heap.length &&
        isWorse(heap[right] as ExtractMatch<T>, heap[worst] as ExtractMatch<T>)
      )
        worst = right;
      if (worst === i) break;
      [heap[i], heap[worst]] = [heap[worst] as ExtractMatch<T>, heap[i] as ExtractMatch<T>];
      i = worst;
    }
  };
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index] as T;
    const text = processor ? processor(choice) : (choice as unknown as string);
    const value = score(text);
    if (value < scoreCutoff) continue;
    const candidate: ExtractMatch<T> = { choice, score: value, index };
    if (heap.length < limit) {
      heap.push(candidate);
      siftUp(heap.length - 1);
    } else if (heap[0] && isWorse(heap[0], candidate)) {
      heap[0] = candidate;
      siftDown(0);
    }
  }
  return heap.sort((a, b) => b.score - a.score || a.index - b.index);
}
