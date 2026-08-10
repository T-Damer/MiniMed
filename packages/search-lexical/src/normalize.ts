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

export function normalizeSurfaceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/[^0-9a-zа-я\s.,:+/%-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
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
  return {
    text: normalizedChars.slice(first, last).join(''),
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
export function levenshteinDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previousRow: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const currentRow: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      const deleteCost = (previousRow[j] ?? maxDistance + 1) + 1;
      const insertCost = (currentRow[j - 1] ?? maxDistance + 1) + 1;
      const substituteCost = (previousRow[j - 1] ?? maxDistance + 1) + substitutionCost;
      const value = Math.min(deleteCost, insertCost, substituteCost);
      currentRow.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previousRow = currentRow;
  }
  return previousRow[right.length] ?? maxDistance + 1;
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
