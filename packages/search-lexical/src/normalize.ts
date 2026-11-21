const STOP_WORDS = new Set([
  'без',
  'бы',
  'в',
  'во',
  'для',
  'до',
  'же',
  'и',
  'из',
  'или',
  'к',
  'как',
  'ко',
  'ли',
  'на',
  'не',
  'но',
  'о',
  'об',
  'от',
  'по',
  'под',
  'при',
  'с',
  'со',
  'у',
  'что',
  'это',
]);

const RUSSIAN_SUFFIXES = [
  'иями',
  'ями',
  'ами',
  'ого',
  'ему',
  'ому',
  'ыми',
  'ими',
  'иях',
  'ях',
  'ах',
  'ение',
  'ания',
  'ений',
  'ание',
  'ость',
  'ости',
  'его',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ой',
  'ей',
  'ий',
  'ый',
  'ам',
  'ям',
  'ом',
  'ем',
  'ов',
  'ев',
  'ия',
  'ья',
  'ью',
  'ы',
  'и',
  'а',
  'я',
  'у',
  'ю',
  'е',
  'о',
].toSorted((left, right) => right.length - left.length);

const ICD10_CYRILLIC_LOOKALIKE_MAP: Readonly<Record<string, string>> = {
  А: 'A',
  а: 'a',
  В: 'B',
  в: 'b',
  С: 'C',
  с: 'c',
  Е: 'E',
  е: 'e',
  Н: 'H',
  н: 'h',
  К: 'K',
  к: 'k',
  М: 'M',
  м: 'm',
  О: 'O',
  о: 'o',
  Р: 'P',
  р: 'p',
  Т: 'T',
  т: 't',
  Х: 'X',
  х: 'x',
  У: 'Y',
  у: 'y',
};

const ICD10_CODE_LIKE_PATTERN =
  /(?<![0-9A-Za-zА-Яа-я])(?<code>[A-Za-zА-Яа-я]\d{2}(?:[.-]\d+|\d+)?)(?![0-9A-Za-zА-Яа-я])/gu;

/** Maps Cyrillic lookalikes only inside an ICD-10-shaped token. */
export function normalizeIcd10Lookalikes(value: string): string {
  return value.replace(ICD10_CODE_LIKE_PATTERN, (token) =>
    [...token].map((character) => ICD10_CYRILLIC_LOOKALIKE_MAP[character] ?? character).join(''),
  );
}

/** Normalize one-off text that should not use up the name and alias cache. */
export function normalizeTransientSurfaceText(value: string): string {
  return normalizeIcd10Lookalikes(
    value
      .normalize('NFKC')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[‐‑‒–—−]/gu, '-')
      .replace(/[^0-9a-zа-я\s.,:+/%-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  );
}

/** Names and aliases are short; longer text (chunks, notes) is not worth keeping. */
const SURFACE_CACHE_MAX_LENGTH = 200;
const SURFACE_CACHE_MAX_ENTRIES = 250_000;
const surfaceCache = new Map<string, string>();

/**
 * Every search index normalizes the same document names and aliases (five passes per core build),
 * and a core rebuilt after a module install does it all again: 1.6 s of the main thread per build
 * at phone speed. The result depends only on the input, so short strings are computed once.
 */
export function normalizeSurfaceText(value: string): string {
  if (value.length > SURFACE_CACHE_MAX_LENGTH) return normalizeTransientSurfaceText(value);
  const known = surfaceCache.get(value);
  if (known !== undefined) return known;
  const normalized = normalizeTransientSurfaceText(value);
  if (surfaceCache.size >= SURFACE_CACHE_MAX_ENTRIES) surfaceCache.clear();
  surfaceCache.set(value, normalized);
  return normalized;
}

/** Remove a navigation preamble, not words inside a disease name or clinical narrative. */
export function searchSubjectText(value: string): string {
  const normalized = normalizeSurfaceText(value);
  const subject = normalized
    .replace(
      /^(?:(?:найти|покажи|показать)\s+)?(?:описание\s+(?:болезни|заболевания)|(?:документы|материалы|информация)\s+(?:по\s+заболеванию|о\s+заболевании|по\s+болезни))\s+/u,
      '',
    )
    .replace(/^(?:найти|покажи|показать)\s+(?:документы|материалы)\s*:?\s+/u, '');
  return subject.trim() || normalized;
}

export interface NormalizedTextOffset {
  readonly start: number;
  readonly end: number;
}

export interface NormalizedTextWithOffsets {
  readonly text: string;
  readonly offsets: readonly NormalizedTextOffset[];
}

const normalizedCodePoints = new Map<string, string>();

function normalizeCodePoint(character: string): string {
  const kept = normalizedCodePoints.get(character);
  if (kept !== undefined) return kept;
  const normalized = character
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/[^0-9a-zа-я\s.,:+/%-]/gu, ' ')
    .replace(/\s/gu, ' ');
  if (normalizedCodePoints.size < 2048) normalizedCodePoints.set(character, normalized);
  return normalized;
}

function surfacePositions(value: string): {
  text: string;
  positions: readonly number[];
  first: number;
} {
  const normalizedChars: string[] = [];
  // Store integer pairs. Search only needs offsets for the characters its terms matched.
  const positions: number[] = [];
  let sourceIndex = 0;
  for (const character of value) {
    const start = sourceIndex;
    sourceIndex += character.length;
    for (const normalizedCharacter of normalizeCodePoint(character)) {
      if (normalizedCharacter === ' ' && normalizedChars.at(-1) === ' ') continue;
      normalizedChars.push(normalizedCharacter);
      positions.push(start, sourceIndex);
    }
  }
  let first = 0;
  let last = normalizedChars.length;
  while (first < last && normalizedChars[first] === ' ') first += 1;
  while (last > first && normalizedChars[last - 1] === ' ') last -= 1;
  const text = normalizedChars.slice(first, last).join('');
  return {
    text: normalizeIcd10Lookalikes(text),
    positions,
    first,
  };
}

/** Maps a normalized interval back to the original UTF-16 interval only when requested. */
export function normalizeSurfaceTextWithSourceRange(value: string): {
  readonly text: string;
  sourceRange(start: number, end: number): NormalizedTextOffset | undefined;
} {
  const { text, positions, first } = surfacePositions(value);
  return {
    text,
    sourceRange(start, end) {
      if (start < 0 || end > text.length || start >= end) return undefined;
      const sourceStart = positions[2 * (first + start)];
      const sourceEnd = positions[2 * (first + end) - 1];
      return sourceStart === undefined || sourceEnd === undefined
        ? undefined
        : { start: sourceStart, end: sourceEnd };
    },
  };
}

export function normalizeSurfaceTextWithOffsets(value: string): NormalizedTextWithOffsets {
  const { text, positions, first } = surfacePositions(value);
  const offsets: NormalizedTextOffset[] = [];
  for (let index = 2 * first; index < 2 * (first + text.length); index += 2) {
    const start = positions[index];
    const end = positions[index + 1];
    if (start !== undefined && end !== undefined) offsets.push({ start, end });
  }
  return { text, offsets };
}

export function tokenize(value: string): readonly string[] {
  return tokenizeNormalizedSurfaceText(normalizeSurfaceText(value));
}

export function tokenizeNormalizedSurfaceText(value: string): readonly string[] {
  return [...value.matchAll(/[0-9a-zа-я]+/gu)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function lightStemRussian(token: string): string {
  if (token.length < 5 || !/[а-я]/u.test(token)) return token;
  for (const suffix of RUSSIAN_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

/**
 * A letters-only Cyrillic term this short is a whole word («боль», «боли», «рак»), not the stem of
 * a longer one. FTS prefix matching would find it inside unrelated words («боли» → «болиголов»),
 * so such a term matches only its own inflected forms (`shortTermInflections`).
 */
const MAX_SHORT_TERM_LENGTH = 4;
const MIN_SHORT_TERM_LENGTH = 3;
const SHORT_CYRILLIC_TERM = /^[а-я]+$/u;
/** Endings (at most three letters) that inflect a short Russian noun or adjective stem. */
const SHORT_TERM_ENDINGS = [
  'а',
  'я',
  'у',
  'ю',
  'е',
  'ы',
  'и',
  'ой',
  'ей',
  'ом',
  'ем',
  'ам',
  'ям',
  'ах',
  'ях',
  'ов',
  'ев',
  'ью',
] as const;

export function isShortCyrillicTerm(term: string): boolean {
  return (
    term.length >= MIN_SHORT_TERM_LENGTH &&
    term.length <= MAX_SHORT_TERM_LENGTH &&
    SHORT_CYRILLIC_TERM.test(term)
  );
}

const shortTermFormsCache = new Map<string, readonly string[]>();

/**
 * The short term and its inflected forms, for exact (non-prefix) matching. A soft sign is dropped
 * before the endings: «боль» also gives «боли», «болей», «болью»; «кровь» gives «крови».
 */
export function shortTermInflections(term: string): readonly string[] {
  const cached = shortTermFormsCache.get(term);
  if (cached) return cached;
  const stem = term.endsWith('ь') ? term.slice(0, -1) : term;
  const forms = [
    ...new Set([
      term,
      ...SHORT_TERM_ENDINGS.map((ending) => `${term}${ending}`),
      ...(stem === term ? [] : SHORT_TERM_ENDINGS.map((ending) => `${stem}${ending}`)),
    ]),
  ];
  shortTermFormsCache.set(term, forms);
  return forms;
}

const WORD_CHARACTER = /[0-9a-zа-я]/u;
const shortTermPatternCache = new Map<string, string>();

/**
 * A stem of 5–6 letters («голов», «печен») is shared by many derived words («головокружение»,
 * «печеночный»). Found in a document it counts as that word only up to an inflection ending of
 * `MAX_STEM_ENDING` letters («головы», «головного»).
 */
const MIN_STEM_LENGTH = 5;
const MAX_STEM_LENGTH = 6;
const MAX_STEM_ENDING = 4;
const STEM_TERM = /^[а-я]+$/u;
const stemPatternCache = new Map<string, RegExp>();

function isBoundedStem(term: string): boolean {
  return term.length >= MIN_STEM_LENGTH && term.length <= MAX_STEM_LENGTH && STEM_TERM.test(term);
}

function stemPattern(term: string): RegExp {
  const cached = stemPatternCache.get(term);
  if (cached) return cached;
  const pattern = new RegExp(
    `(?<![0-9a-zа-я])${term}[а-я]{0,${MAX_STEM_ENDING}}(?![0-9a-zа-я])`,
    'gu',
  );
  stemPatternCache.set(term, pattern);
  return pattern;
}

function shortTermPattern(term: string): string {
  const cached = shortTermPatternCache.get(term);
  if (cached) return cached;
  const pattern = `(?<![0-9a-zа-я])(?:${shortTermInflections(term).join('|')})(?![0-9a-zа-я])`;
  shortTermPatternCache.set(term, pattern);
  return pattern;
}

/**
 * Every place where normalized `term` starts a word of normalized `text` — never the inside of a
 * longer word. A short Cyrillic term only matches one of its inflected forms, so «боли» is found in
 * «боли в животе» and «болью», never in «болиголов». Longer terms stay prefixes (stems such as
 * «голов» find «головного»), as FTS5 prefix tokens do; their range covers the term only.
 */
export function findWordPrefixMatches(
  text: string,
  term: string,
): readonly { readonly start: number; readonly end: number }[] {
  if (term.length === 0) return [];
  const matches: { start: number; end: number }[] = [];
  if (isBoundedStem(term)) {
    for (const match of text.matchAll(stemPattern(term)))
      matches.push({ start: match.index, end: match.index + term.length });
    return matches;
  }
  if (isShortCyrillicTerm(term)) {
    for (const match of text.matchAll(new RegExp(shortTermPattern(term), 'gu')))
      matches.push({ start: match.index, end: match.index + match[0].length });
    return matches;
  }
  let from = 0;
  while (from <= text.length - term.length) {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    if (index === 0 || !WORD_CHARACTER.test(text[index - 1] ?? ''))
      matches.push({ start: index, end: index + term.length });
    from = index + term.length;
  }
  return matches;
}

export function hasWordPrefix(text: string, term: string): boolean {
  if (term.length === 0) return false;
  if (isBoundedStem(term)) return new RegExp(stemPattern(term).source, 'u').test(text);
  if (isShortCyrillicTerm(term)) return new RegExp(shortTermPattern(term), 'u').test(text);
  let from = 0;
  while (from <= text.length - term.length) {
    const index = text.indexOf(term, from);
    if (index < 0) return false;
    if (index === 0 || !WORD_CHARACTER.test(text[index - 1] ?? '')) return true;
    from = index + 1;
  }
  return false;
}

export function normalizeForIndex(value: string): string {
  const forms = new Set<string>();
  for (const token of tokenize(value)) {
    forms.add(token);
    forms.add(lightStemRussian(token));
  }
  return [...forms].join(' ');
}

/**
 * Bounded Levenshtein distance. Returns `maxDistance + 1` (a cheap "too far" sentinel) as soon as
 * the edit distance provably exceeds the budget, so callers never pay for a full O(n*m) table on
 * clearly unrelated tokens.
 */
// Reused rows: fuzzy alias matching compares thousands of token pairs per query.
let previousRowBuffer = new Int32Array(64);
let currentRowBuffer = new Int32Array(64);

/**
 * Exact edit distance when it is at most `maxDistance`, otherwise `maxDistance + 1`. Only the
 * diagonal band of width ±maxDistance can stay within the bound, so cells outside it are skipped.
 */
export function levenshteinDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  const over = maxDistance + 1;
  const width = right.length + 1;
  if (previousRowBuffer.length < width) {
    previousRowBuffer = new Int32Array(width * 2);
    currentRowBuffer = new Int32Array(width * 2);
  }
  let previousRow = previousRowBuffer;
  let currentRow = currentRowBuffer;
  for (let j = 0; j < width; j += 1) previousRow[j] = j <= maxDistance ? j : over;
  for (let i = 1; i <= left.length; i += 1) {
    const from = Math.max(1, i - maxDistance);
    const to = Math.min(right.length, i + maxDistance);
    currentRow[0] = i <= maxDistance ? i : over;
    if (from > 1) currentRow[from - 1] = over;
    let rowMin = currentRow[0] ?? over;
    const leftCode = left.charCodeAt(i - 1);
    for (let j = from; j <= to; j += 1) {
      const substitute =
        (previousRow[j - 1] ?? over) + (leftCode === right.charCodeAt(j - 1) ? 0 : 1);
      const remove = (previousRow[j] ?? over) + 1;
      const insert = (currentRow[j - 1] ?? over) + 1;
      const value = Math.min(over, substitute, remove, insert);
      currentRow[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (to < right.length) currentRow[to + 1] = over;
    if (rowMin > maxDistance) return over;
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }
  return Math.min(over, previousRow[right.length] ?? over);
}

/**
 * Below this length, single-edit typos are indistinguishable from genuinely different clinical
 * words (e.g. "боль" vs "моль"), so short tokens only ever match exactly.
 */
export const MIN_FUZZY_TOKEN_LENGTH = 5;
const LONG_FUZZY_TOKEN_LENGTH = 9;

/** Typo/word-form tolerant token match: exact for short tokens, bounded edit distance otherwise. */
export function isCloseToken(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < MIN_FUZZY_TOKEN_LENGTH || right.length < MIN_FUZZY_TOKEN_LENGTH) return false;
  const maxDistance = Math.max(left.length, right.length) >= LONG_FUZZY_TOKEN_LENGTH ? 2 : 1;
  return levenshteinDistance(left, right, maxDistance) <= maxDistance;
}
