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

export function normalizeSurfaceText(value: string): string {
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

export function normalizeSurfaceTextWithOffsets(value: string): NormalizedTextWithOffsets {
  const normalizedChars: string[] = [];
  const offsets: NormalizedTextOffset[] = [];
  let sourceIndex = 0;
  for (const character of value) {
    const start = sourceIndex;
    sourceIndex += character.length;
    const normalized = character
      .normalize('NFKC')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[‐‑‒–—−]/gu, '-')
      .replace(/[^0-9a-zа-я\s.,:+/%-]/gu, ' ');
    for (const normalizedCharacter of normalized) {
      if (/\s/u.test(normalizedCharacter)) {
        if (normalizedChars.at(-1) === ' ') continue;
        normalizedChars.push(' ');
        offsets.push({ start, end: sourceIndex });
      } else {
        normalizedChars.push(normalizedCharacter);
        offsets.push({ start, end: sourceIndex });
      }
    }
  }
  let first = 0;
  let last = normalizedChars.length;
  while (first < last && normalizedChars[first] === ' ') first += 1;
  while (last > first && normalizedChars[last - 1] === ' ') last -= 1;
  const text = normalizedChars.slice(first, last).join('');
  return {
    text: normalizeIcd10Lookalikes(text),
    offsets: offsets.slice(first, last),
  };
}

export function tokenize(value: string): readonly string[] {
  return [...normalizeSurfaceText(value).matchAll(/[0-9a-zа-я]+/gu)]
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
