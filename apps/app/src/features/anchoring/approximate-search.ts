/**
 * Approximate substring search, implemented locally (a diff-match-patch style fuzzy locate without
 * its 32-character pattern limit).
 *
 * 1. `candidateWindows` finds where in a long text the pattern's rarer words occur and groups the
 *    hits by the diagonal they imply, so only a few short windows ever need aligning.
 * 2. `alignPattern` aligns the pattern with a window by edit distance (Sellers: free start and end
 *    in the text, unit cost for substitution, insertion and deletion) and traces back the span.
 *
 * Both work on folded text (see `text-fold.ts`); offsets are folded offsets.
 */

export interface ApproximateMatch {
  /** Folded offsets of the best aligned span, `end` exclusive. */
  readonly start: number;
  readonly end: number;
  /** Edit distance between the pattern and the span. */
  readonly errors: number;
}

export interface SearchWindow {
  readonly from: number;
  readonly to: number;
  /** Distinct pattern words found in the window. */
  readonly votes: number;
}

/** Longest pattern aligned in one piece; longer ones are matched by their ends. */
export const ALIGN_PATTERN_LIMIT = 720;

/**
 * Best alignment of `pattern` inside `text[from, to)` with at most `maxErrors` edits, or `null`.
 * Among equal distances the span closest in length to the pattern wins.
 */
export function alignPattern(
  pattern: string,
  text: string,
  from: number,
  to: number,
  maxErrors: number,
): ApproximateMatch | null {
  const m = pattern.length;
  const start = Math.max(0, from);
  const end = Math.min(text.length, to);
  const w = end - start;
  if (m === 0 || w <= 0) return null;
  const columns = w + 1;
  const table = new Uint16Array((m + 1) * columns);
  // Row 0 is all zeros: the span may start anywhere. Column 0 costs one deletion per row.
  for (let i = 1; i <= m; i += 1) table[i * columns] = Math.min(i, 0xffff);
  for (let i = 1; i <= m; i += 1) {
    const patternCode = pattern.charCodeAt(i - 1);
    const row = i * columns;
    const above = row - columns;
    for (let j = 1; j <= w; j += 1) {
      const diagonal =
        (table[above + j - 1] ?? 0) + (text.charCodeAt(start + j - 1) === patternCode ? 0 : 1);
      const deletion = (table[above + j] ?? 0) + 1;
      const insertion = (table[row + j - 1] ?? 0) + 1;
      let best = diagonal;
      if (deletion < best) best = deletion;
      if (insertion < best) best = insertion;
      table[row + j] = best;
    }
  }
  const last = m * columns;
  let minimum = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= w; j += 1) {
    const value = table[last + j] ?? 0xffff;
    if (value < minimum) minimum = value;
  }
  if (minimum > maxErrors) return null;

  let bestMatch: ApproximateMatch | null = null;
  let bestLengthGap = Number.POSITIVE_INFINITY;
  let traced = 0;
  for (let j = 0; j <= w && traced < 12; j += 1) {
    if ((table[last + j] ?? 0xffff) !== minimum) continue;
    traced += 1;
    let i = m;
    let column = j;
    while (i > 0) {
      const here = table[i * columns + column] ?? 0;
      if (
        column > 0 &&
        here ===
          (table[(i - 1) * columns + column - 1] ?? 0) +
            (text.charCodeAt(start + column - 1) === pattern.charCodeAt(i - 1) ? 0 : 1)
      ) {
        i -= 1;
        column -= 1;
      } else if (here === (table[(i - 1) * columns + column] ?? 0) + 1) {
        i -= 1;
      } else {
        column -= 1;
      }
    }
    const gap = Math.abs(j - column - m);
    if (gap < bestLengthGap) {
      bestLengthGap = gap;
      bestMatch = { start: start + column, end: start + j, errors: minimum };
    }
  }
  return bestMatch;
}

interface PatternWord {
  readonly stem: string;
  readonly offset: number;
}

const STEM_LENGTH = 6;
const MIN_WORD_LENGTH = 4;
const MAX_WORDS = 14;
const MAX_HITS_PER_WORD = 400;

function patternWords(pattern: string, minimum: number): readonly PatternWord[] {
  const words: PatternWord[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const word of pattern.split(' ')) {
    if (word.length >= minimum) {
      const stem = word.slice(0, STEM_LENGTH);
      if (!seen.has(stem)) {
        seen.add(stem);
        words.push({ stem, offset });
      }
    }
    offset += word.length + 1;
  }
  if (words.length <= MAX_WORDS) return words;
  // Keep the longest words (the rarest), spread over the pattern by their offsets afterwards.
  return words
    .toSorted((left, right) => right.stem.length - left.stem.length || left.offset - right.offset)
    .slice(0, MAX_WORDS)
    .toSorted((left, right) => left.offset - right.offset);
}

/**
 * Windows of `text` where the pattern's words cluster on one diagonal, best first. A window is
 * wide enough for the pattern plus the shift that insertions and deletions can cause.
 */
export function candidateWindows(
  pattern: string,
  text: string,
  limit = 6,
): readonly SearchWindow[] {
  const m = pattern.length;
  let words = patternWords(pattern, MIN_WORD_LENGTH);
  if (words.length === 0) words = patternWords(pattern, 2);
  if (words.length === 0) return [];
  const slack = Math.max(24, Math.ceil(m * 0.4));
  const diagonals: { readonly diagonal: number; readonly word: number }[] = [];
  words.forEach((word, wordIndex) => {
    let position = text.indexOf(word.stem);
    let hits = 0;
    const found: number[] = [];
    while (position >= 0 && hits <= MAX_HITS_PER_WORD) {
      found.push(position - word.offset);
      hits += 1;
      position = text.indexOf(word.stem, position + 1);
    }
    // A stem that occurs everywhere says nothing about where the pattern is.
    if (hits > MAX_HITS_PER_WORD) return;
    for (const diagonal of found) diagonals.push({ diagonal, word: wordIndex });
  });
  diagonals.sort((left, right) => left.diagonal - right.diagonal);

  const windows: SearchWindow[] = [];
  let index = 0;
  while (index < diagonals.length) {
    let stop = index;
    const lowest = diagonals[index]?.diagonal ?? 0;
    const voters = new Set<number>();
    let highest = lowest;
    while (stop < diagonals.length && (diagonals[stop]?.diagonal ?? 0) - lowest <= slack) {
      const entry = diagonals[stop];
      if (entry) {
        voters.add(entry.word);
        highest = entry.diagonal;
      }
      stop += 1;
    }
    windows.push({
      from: Math.max(0, lowest - slack),
      to: Math.min(text.length, highest + m + slack),
      votes: voters.size,
    });
    index = stop;
  }
  const needed = words.length <= 3 ? 1 : 2;
  return windows
    .filter((window) => window.votes >= needed)
    .toSorted((left, right) => right.votes - left.votes)
    .slice(0, limit);
}
