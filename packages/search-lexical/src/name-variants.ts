/**
 * Keyboard-layout and transliteration variants of a typed name (roadmap item 3, S3).
 *
 * «ьуеащкьшт» is «metformin» typed on the Russian layout, «vtnajhvby» is «метформин» typed on the
 * English one, «nurofen» is a Latin spelling of «нурофен». Everything here is deterministic string
 * work; whether a variant is a real name is decided by the caller against the mounted corpus, and
 * only when the typed form itself found no matching title. Nothing is a symptom or disease
 * dictionary.
 */

/** QWERTY → ЙЦУКЕН by physical key (lower case; the shifted forms follow by lower-casing). */
const EN_TO_RU: Readonly<Record<string, string>> = {
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
  '`': 'ё',
};
const RU_TO_EN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EN_TO_RU).map(([latin, cyrillic]) => [cyrillic, latin]),
);
/** Layout punctuation that is a letter on the other layout. */
const LAYOUT_PUNCTUATION = new Set(['[', ']', ';', "'", ',', '.', '`']);

export type NameVariantKind = 'layout' | 'transliteration' | 'layout-transliteration';

export interface NameVariant {
  readonly kind: NameVariantKind;
  /** The query to search instead of the typed one, lower case. */
  readonly query: string;
}

/** A name-style query: at most three words, one of them with at least four letters. */
export const MAX_NAME_QUERY_WORDS = 3;
const MIN_NAME_LETTERS = 4;
const MAX_VARIANTS = 6;
const LATIN_LETTER = /[a-z]/u;
const CYRILLIC_LETTER = /[а-яё]/u;

interface Typed {
  readonly words: readonly string[];
  readonly script: 'latin' | 'cyrillic';
}

/** The typed words when the query is name-shaped and written in one script, otherwise null. */
function typedName(query: string): Typed | null {
  const lower = query.normalize('NFKC').toLowerCase().trim();
  if (lower.length === 0 || lower.length > 64) return null;
  const words = lower.split(/\s+/u);
  if (words.length > MAX_NAME_QUERY_WORDS) return null;
  let latin = 0;
  let cyrillic = 0;
  for (const character of lower) {
    if (LATIN_LETTER.test(character)) latin += 1;
    else if (CYRILLIC_LETTER.test(character)) cyrillic += 1;
    else if (!/[0-9\s\-[\];',.`]/u.test(character)) return null;
  }
  if (latin > 0 && cyrillic > 0) return null;
  if (Math.max(latin, cyrillic) < MIN_NAME_LETTERS) return null;
  return { words, script: latin > 0 ? 'latin' : 'cyrillic' };
}

/** Maps one word through a layout table; punctuation keys only inside a word without digits. */
function swapWord(word: string, table: Readonly<Record<string, string>>): string {
  const mapPunctuation = !/[0-9]/u.test(word);
  let swapped = '';
  for (const character of word) {
    const mapped = table[character];
    if (mapped === undefined) swapped += character;
    else if (LAYOUT_PUNCTUATION.has(character) && !mapPunctuation) swapped += character;
    else swapped += mapped;
  }
  return swapped;
}

// ---- Latin → Cyrillic ------------------------------------------------------------------------

interface Segment {
  /** Readings in order of preference; the first one is the default. */
  readonly readings: readonly string[];
  /** Lower number = flipped earlier when producing alternatives. */
  readonly priority: number;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const SINGLE: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'б',
  d: 'д',
  f: 'ф',
  g: 'г',
  i: 'и',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  z: 'з',
};
/** Longest match first; readings in order of preference. */
const MULTI: readonly (readonly [string, readonly string[], number])[] = [
  ['sch', ['щ'], 9],
  ['tch', ['ч'], 9],
  ['shch', ['щ'], 9],
  ['sh', ['ш'], 9],
  ['zh', ['ж'], 9],
  ['kh', ['х'], 9],
  ['ts', ['ц'], 9],
  ['ph', ['ф'], 9],
  ['th', ['т'], 9],
  ['ck', ['к'], 9],
  ['qu', ['кв', 'ку'], 8],
  ['gh', ['г'], 9],
  ['iya', ['ия'], 9],
  ['aya', ['ая'], 9],
  ['yy', ['ый', 'ии'], 8],
  ['iy', ['ий'], 9],
  ['oy', ['ой'], 9],
  ['ay', ['ай'], 9],
  ['ey', ['ей'], 9],
  ['ya', ['я'], 9],
  ['yu', ['ю'], 9],
  ['yo', ['ё', 'йо'], 9],
  ['ye', ['е', 'йе'], 9],
  ['ee', ['и'], 9],
  ['oo', ['у'], 9],
  ['ou', ['у', 'ау'], 8],
  ['ae', ['е', 'э'], 7],
  ['oe', ['е', 'э'], 7],
  ['ei', ['еи', 'ей'], 6],
  ['ie', ['ие', 'и'], 9],
];

function segments(word: string): readonly Segment[] {
  const result: Segment[] = [];
  let index = 0;
  while (index < word.length) {
    const rest = word.slice(index);
    const multi = MULTI.find(([latin]) => rest.startsWith(latin));
    if (multi) {
      result.push({ readings: multi[1], priority: multi[2] });
      index += multi[0].length;
      continue;
    }
    if (rest.startsWith('ch')) {
      // Greek «хлор-, холе-, хром-» before a consonant or «o», Slavic «ч» before other vowels.
      const following = word[index + 2] ?? '';
      result.push({
        readings: /[aeiuy]/u.test(following) ? ['ч', 'х'] : ['х', 'ч'],
        priority: 2,
      });
      index += 2;
      continue;
    }
    if (rest === 'um' && index > 2) {
      // Latin INN ending «-um» («Cetirizinum»): usually dropped in Russian.
      result.push({ readings: ['', 'ум'], priority: 1 });
      index += 2;
      continue;
    }
    const character = word[index] ?? '';
    const next = word[index + 1] ?? '';
    const previous = word[index - 1] ?? '';
    const atEnd = index === word.length - 1;
    let segment: Segment;
    if (character === 'c') {
      const soft = next === 'e' || next === 'i' || next === 'y';
      segment = { readings: soft ? ['ц', 'к'] : ['к', 'ц'], priority: 3 };
    } else if (character === 'e') {
      const initial = index === 0 || VOWELS.has(previous);
      const silent = atEnd && index > 2 && !VOWELS.has(previous);
      segment = silent
        ? { readings: ['', 'е'], priority: 5 }
        : { readings: initial ? ['э', 'е'] : ['е', 'э'], priority: 1 };
    } else if (character === 'h') {
      segment = { readings: ['г', 'х'], priority: 2 };
    } else if (character === 'y') {
      segment = {
        readings: VOWELS.has(previous) ? ['й', 'и', 'ы'] : ['и', 'й', 'ы'],
        priority: 4,
      };
    } else if (character === 'j') {
      segment = { readings: ['й', 'дж', 'ж'], priority: 6 };
    } else if (character === 'x') {
      segment = { readings: ['кс'], priority: 9 };
    } else if (character === 'l' && 'nktd'.includes(next) && next !== '') {
      segment = { readings: ['л', 'ль'], priority: 8 };
    } else if (character === previous && !VOWELS.has(character) && SINGLE[character]) {
      // The second letter of a double consonant: Russian drug names keep «лл» in «-циллин» but
      // lose «сс» in «дексаметазон»; the doubled reading is the default.
      segment = { readings: [SINGLE[character], ''], priority: 7 };
    } else {
      segment = { readings: [SINGLE[character] ?? character], priority: 9 };
    }
    result.push(segment);
    index += 1;
  }
  return result;
}

/** Default reading plus one-segment flips, most common ambiguities first. */
function wordReadings(word: string, limit: number): readonly string[] {
  const parts = segments(word);
  const base = parts.map((part) => part.readings[0] ?? '');
  const readings = [base.join('')];
  const flips = parts
    .map((part, position) => ({ part, position }))
    .filter(({ part }) => part.readings.length > 1)
    .toSorted((left, right) => left.part.priority - right.part.priority);
  for (const { part, position } of flips) {
    for (const alternative of part.readings.slice(1)) {
      const variant = [...base];
      variant[position] = alternative;
      readings.push(variant.join(''));
    }
  }
  return [...new Set(readings)].slice(0, limit);
}

/** Letter run of a Latin word with its number prefix kept: «400mg» → «400» + «мг». */
function transliterateWord(word: string, limit: number): readonly string[] | null {
  const match = /^(?<digits>[0-9]*)(?<letters>[a-z]+(?:-[a-z]+)*)$/u.exec(word);
  if (!match?.groups) return /^[0-9]+$/u.test(word) ? [word] : null;
  const digits = match.groups['digits'] ?? '';
  const letters = match.groups['letters'] ?? '';
  const parts = letters.split('-').map((part) => wordReadings(part, limit));
  let combined: readonly string[] = [''];
  for (const [position, readings] of parts.entries())
    combined = combined.flatMap((prefix) =>
      readings
        .slice(0, position === 0 ? limit : 2)
        .map((reading) => `${prefix}${position === 0 ? '' : '-'}${reading}`),
    );
  return combined.slice(0, limit).map((reading) => `${digits}${reading}`);
}

/** Latin spellings of a name as Russian readings: «nurofen» → «нурофен», «ibuprofen» → «ибупрофен». */
export function transliterateLatinName(query: string, limit = 4): readonly string[] {
  const typed = typedName(query);
  if (!typed || typed.script !== 'latin') return [];
  const perWord = typed.words.map((word) => transliterateWord(word, limit));
  if (perWord.some((readings) => readings === null)) return [];
  const words = perWord as readonly (readonly string[])[];
  const joined = [words.map((readings) => readings[0] ?? '').join(' ')];
  // Alternatives vary one word at a time; combining all of them would explode for three words.
  for (const [position, readings] of words.entries())
    for (const reading of readings.slice(1))
      joined.push(
        words.map((other, index) => (index === position ? reading : (other[0] ?? ''))).join(' '),
      );
  return [...new Set(joined)].slice(0, limit);
}

/** The query as it would read after pressing the same keys on the other layout. */
export function swapKeyboardLayout(query: string): string | null {
  const typed = typedName(query);
  if (!typed) return null;
  const table = typed.script === 'latin' ? EN_TO_RU : RU_TO_EN;
  const swapped = typed.words.map((word) => swapWord(word, table)).join(' ');
  return swapped === typed.words.join(' ') ? null : swapped;
}

/**
 * Candidate rewrites of a name-shaped query, ordered: the other keyboard layout first, then the
 * Russian readings of Latin spellings (typed, or recovered from a Russian-layout slip). Empty for
 * anything that is not a short name-shaped query; the caller validates each candidate.
 */
export function nameQueryVariants(query: string, limit = MAX_VARIANTS): readonly NameVariant[] {
  const typed = typedName(query);
  if (!typed) return [];
  const variants: NameVariant[] = [];
  const swapped = swapKeyboardLayout(query);
  if (swapped) variants.push({ kind: 'layout', query: swapped });
  if (typed.script === 'latin') {
    for (const reading of transliterateLatinName(query))
      variants.push({ kind: 'transliteration', query: reading });
  } else if (swapped && !/[^a-z\s-]/u.test(swapped)) {
    for (const reading of transliterateLatinName(swapped, 3))
      variants.push({ kind: 'layout-transliteration', query: reading });
  }
  const seen = new Set([typed.words.join(' ')]);
  return variants
    .filter((variant) => !seen.has(variant.query) && seen.add(variant.query))
    .slice(0, limit);
}
