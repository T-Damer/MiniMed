/**
 * Spelling correction of one typed word against the names the corpus holds (roadmap item 19,
 * TYPO1). Matching from the start of the word already forgives a slip late in a word
 * («пиелонифрит» still finds «пиелонефрит» by its first letters); a slip in the first letters
 * («оменция» for «аменция», «помоач» for «помрач…») finds nothing, and this module repairs it.
 *
 * The typed word is compared with every *beginning* of a name word (a weighted edit distance whose
 * last row is read at every depth of an implicit trie over the sorted vocabulary), so a word still
 * being typed is corrected to the beginning of the name it starts. Slips a doctor actually makes
 * cost half an edit: a neighbouring key of the ЙЦУКЕН or QWERTY layout, a letter that sounds the
 * same in an unstressed or devoiced position (о/а, е/и, з/с…), a soft or hard sign, a doubled
 * letter. Any other substitution, a missing or an extra letter costs one edit; two swapped letters
 * cost 0.6.
 */

export interface NameVocabulary {
  /** Distinct normalized name words, sorted by code unit. */
  readonly words: readonly string[];
  /** `weights[i]` = documents naming `words[0..i)`: prefix sums for the weight of a word range. */
  readonly weights: Readonly<Uint32Array>;
}

export interface WordCorrection {
  readonly original: string;
  /** The name word, or its beginning when the typed word is shorter than the name. */
  readonly corrected: string;
  /** Weighted edit cost; at most `maxTypoCost(original.length)`. */
  readonly cost: number;
}

/** Words shorter than this are never corrected: too many names lie one slip away. */
export const MIN_CORRECTED_WORD_LENGTH = 4;

/** Budget of edits for a typed word of `length` letters. */
export function maxTypoCost(length: number): number {
  if (length < MIN_CORRECTED_WORD_LENGTH) return 0;
  if (length <= 5) return 0.5;
  if (length <= 8) return 1;
  if (length <= 11) return 1.5;
  return 2;
}

const CHEAP = 0.5;
const SWAP = 0.6;
const FULL = 1;
/** Per letter of a typed ending kept after a corrected stem («оменции» → «аменци» + «и»). */
const ENDING = 0.25;
const MAX_ENDING = 2;
/** A typed word whose first letters (all but an ending) begin a name is a word form, not a slip. */
const MIN_KNOWN_STEM = 5;

/** Rows of the Russian and the Latin layout with each row's horizontal offset in key widths. */
const KEY_ROWS: readonly (readonly [string, number])[] = [
  ['йцукенгшщзхъ', 0],
  ['фывапролджэ', 0.25],
  ['ячсмитьбю', 0.75],
  ['qwertyuiop', 0],
  ['asdfghjkl', 0.25],
  ['zxcvbnm', 0.75],
];

/** Letters that sound alike in some position of a Russian word, and the usual Latin confusions. */
const SOUND_ALIKE = [
  'ао',
  'еи',
  'иы',
  'еэ',
  'ея',
  'юу',
  'зс',
  'дт',
  'бп',
  'вф',
  'гк',
  'жш',
  'шщ',
  'чщ',
  'цс',
  'ck',
  'sz',
  'iy',
];

const SILENT = new Set(['ь', 'ъ']);

const cheapPairs: ReadonlySet<string> = (() => {
  const pairs = new Set<string>();
  const add = (left: string, right: string) => {
    pairs.add(left + right);
    pairs.add(right + left);
  };
  const keys = KEY_ROWS.flatMap(([letters, offset], row) =>
    [...letters].map((letter, index) => ({ letter, row, x: index + offset })),
  );
  for (const left of keys)
    for (const right of keys) {
      if (left === right) continue;
      const rows = Math.abs(left.row - right.row);
      const dx = Math.abs(left.x - right.x);
      const sameLayout = left.row < 3 === right.row < 3;
      if (sameLayout && ((rows === 0 && dx === 1) || (rows === 1 && dx < 1)))
        add(left.letter, right.letter);
    }
  for (const pair of SOUND_ALIKE) add(pair[0] ?? '', pair[1] ?? '');
  return pairs;
})();

function substitutionCost(typed: string, intended: string): number {
  if (typed === intended) return 0;
  return cheapPairs.has(typed + intended) ? CHEAP : FULL;
}

/** A letter present on one side only: a sign or a doubled letter is a cheap slip. */
function gapCost(letter: string, previous: string | undefined): number {
  return SILENT.has(letter) || letter === previous ? CHEAP : FULL;
}

const NAME_WORD = /[0-9a-zа-я]+/gu;

/**
 * Builds the vocabulary from already normalized names (`normalizeSurfaceText`), each name given
 * once per document so that a word's weight is the number of documents naming it.
 */
export function buildNameVocabulary(names: Iterable<string>): NameVocabulary {
  const counts = new Map<string, number>();
  for (const name of names)
    for (const word of new Set(name.match(NAME_WORD) ?? []))
      counts.set(word, (counts.get(word) ?? 0) + 1);
  const words = [...counts.keys()].sort();
  const weights = new Uint32Array(words.length + 1);
  for (const [index, word] of words.entries())
    weights[index + 1] = (weights[index] ?? 0) + (counts.get(word) ?? 0);
  return { words, weights };
}

/** First index in `[low, high)` whose word is not below `prefix`. */
function lowerBound(words: readonly string[], prefix: string, low: number, high: number): number {
  let lo = low;
  let hi = high;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if ((words[middle] ?? '') < prefix) lo = middle + 1;
    else hi = middle;
  }
  return lo;
}

/** True when some name word of the vocabulary begins with `prefix`. */
export function vocabularyHasPrefix(vocabulary: NameVocabulary, prefix: string): boolean {
  const index = lowerBound(vocabulary.words, prefix, 0, vocabulary.words.length);
  return vocabulary.words[index]?.startsWith(prefix) ?? false;
}

interface Best {
  cost: number;
  corrected: string;
  /** The corrected form is a whole vocabulary word rather than the beginning of one. */
  whole: boolean;
  /** How far the corrected length is from the typed length; a nearer length wins a tie. */
  lengthGap: number;
  weight: number;
}

function better(candidate: Best, best: Best | null): boolean {
  if (!best) return true;
  if (candidate.cost !== best.cost) return candidate.cost < best.cost;
  if (candidate.whole !== best.whole) return candidate.whole;
  if (candidate.lengthGap !== best.lengthGap) return candidate.lengthGap < best.lengthGap;
  return candidate.weight > best.weight;
}

/** Russian case and number endings begin with a vowel, «й» or «ь» («-ей», «-ом», «-ах», «-ь»). */
const ENDING_START = /^[аеиоуыэюяйь]/u;

/** Letters an inflection ending can start with. */
const ENDING_LETTERS = [...'аеиоуыэюяйь'];

/**
 * True when `word`, or its stem without an inflection ending of up to two letters, begins some
 * name of the vocabulary where an ending follows the stem too («аменцией»: «аменци» + «я»). A
 * dropped consonant is no ending: «цефтриаксн» is a slip, and so is «амоксицилин», whose stem
 * «амоксицил» goes on with a consonant in «амоксициллин».
 */
function isKnownWord(word: string, vocabulary: NameVocabulary): boolean {
  if (vocabularyHasPrefix(vocabulary, word)) return true;
  for (let ending = 1; ending <= MAX_ENDING; ending += 1) {
    const stem = word.slice(0, word.length - ending);
    if (stem.length < MIN_KNOWN_STEM) break;
    if (
      ENDING_START.test(word.slice(stem.length)) &&
      ENDING_LETTERS.some((letter) => vocabularyHasPrefix(vocabulary, stem + letter))
    )
      return true;
  }
  return false;
}

/**
 * The closest beginning of a vocabulary word to `word` within the cost budget, or null when the
 * word (or its stem) already begins some name or nothing is close enough. A corrected stem may keep
 * the typed ending of up to two letters. Ties go to a whole vocabulary word, then to the corrected
 * form whose length is nearest the typed one, then to the one more documents name.
 */
export function correctWord(word: string, vocabulary: NameVocabulary): WordCorrection | null {
  const budget = maxTypoCost(word.length);
  if (budget === 0 || isKnownWord(word, vocabulary)) return null;
  const { words, weights } = vocabulary;
  const typed = [...word];
  const length = typed.length;
  // Each letter beyond the typed length costs at least CHEAP, which bounds the depth.
  const maxDepth = length + Math.floor(budget / CHEAP);
  const found: { best: Best | null } = { best: null };

  const firstRow = new Float64Array(length + 1);
  for (let index = 1; index <= length; index += 1)
    firstRow[index] =
      (firstRow[index - 1] ?? 0) + gapCost(typed[index - 1] ?? '', typed[index - 2]);

  // Depth-first walk of the implicit trie: the words in [low, high) share `prefix`.
  const visit = (
    prefix: string,
    low: number,
    high: number,
    row: Float64Array,
    previousRow: Float64Array | null,
  ): void => {
    const depth = prefix.length;
    let start = low;
    while (start < high && (words[start] ?? '').length === depth) start += 1;
    while (start < high) {
      const letter = (words[start] ?? '')[depth] ?? '';
      const childPrefix = prefix + letter;
      const end = lowerBound(words, `${childPrefix}￿`, start, high);
      const next = new Float64Array(length + 1);
      const previousLetter = prefix[depth - 1];
      next[0] = (row[0] ?? 0) + gapCost(letter, previousLetter);
      let rowMin = next[0] ?? 0;
      for (let index = 1; index <= length; index += 1) {
        const typedLetter = typed[index - 1] ?? '';
        let cost = Math.min(
          (row[index - 1] ?? 0) + substitutionCost(typedLetter, letter),
          (row[index] ?? 0) + gapCost(letter, previousLetter),
          (next[index - 1] ?? 0) + gapCost(typedLetter, typed[index - 2]),
        );
        if (
          previousRow &&
          index > 1 &&
          typedLetter === previousLetter &&
          typed[index - 2] === letter &&
          letter !== previousLetter
        )
          cost = Math.min(cost, (previousRow[index - 2] ?? 0) + SWAP);
        next[index] = cost;
        if (cost < rowMin) rowMin = cost;
      }
      if (rowMin <= budget) {
        const weight = (weights[end] ?? 0) - (weights[start] ?? 0);
        const whole = words[start] === childPrefix;
        for (let ending = 0; ending <= MAX_ENDING; ending += 1) {
          if (ending > 0 && length - ending < MIN_CORRECTED_WORD_LENGTH) break;
          const cost = (next[length - ending] ?? Number.POSITIVE_INFINITY) + ending * ENDING;
          const corrected = childPrefix + typed.slice(length - ending).join('');
          if (cost > budget || corrected === word) continue;
          const candidate: Best = {
            cost,
            corrected,
            whole: ending === 0 && whole,
            lengthGap: Math.abs(corrected.length - length),
            weight,
          };
          if (better(candidate, found.best)) found.best = candidate;
        }
        if (depth + 1 < maxDepth) visit(childPrefix, start, end, next, row);
      }
      start = end;
    }
  };
  visit('', 0, words.length, firstRow, null);

  const { best } = found;
  return best ? { original: word, corrected: best.corrected, cost: best.cost } : null;
}
