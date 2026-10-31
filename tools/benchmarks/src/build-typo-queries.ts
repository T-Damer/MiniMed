/**
 * Builds `tools/benchmarks/typo-queries.json` (roadmap item 19, TYPO1): real names with one slip
 * of the kind a doctor makes, generated deterministically from the names of
 * `name-variant-queries.json` (ЕСКЛП МНН, Allmed trade names, disease articles, КР titles), plus
 * the negative controls that must not change.
 *
 *   bun tools/benchmarks/src/build-typo-queries.ts
 *
 * Variants, applied to the first word of the name that has five letters or more:
 *  - `neighbour`: a letter among the first three replaced by the next key of its ЙЦУКЕН row
 *    («помрач» → «помоач»);
 *  - `sound`: the first а/о/е/и/я/э among the first four letters replaced by the vowel that sounds
 *    alike unstressed («аменция» → «оменция»);
 *  - `other`: a letter among the first three replaced by an unrelated one (words of six letters or
 *    more: one full edit);
 *  - `late`: a neighbour key two letters before the end — matching from the start already forgives
 *    it, so the set shows the fallback does not hurt.
 * Controls: the name-variant controls (codes, Latin terms, correctly typed names) and the owner's
 * queries, whose first ten groups must be identical with and without the correction.
 *
 * The harder set (roadmap item 24, `tier: 'hard'`, appended after the basic cases so that their
 * ids stay) takes the first word of the same names that has the letters the variant needs and
 * writes it wrong in the ways of real misspellings, anywhere in the word:
 *  - `mid`: a neighbouring key in the middle of a word of six letters or more;
 *  - `two-cheap`: two slips (neighbouring keys, sound-alike vowels), one in each half;
 *  - `two-full`: two unrelated letters, one in each half (two full edits, words of seven letters or more);
 *  - `drop` / `double`: a letter left out / typed twice in the middle;
 *  - `vowels`: two unstressed vowels written by sound (о/а, е/и, я/е);
 *  - `consonant`: a doubled consonant written single (or a single one doubled), or a voiced/voiceless
 *    pair (з/с, д/т, б/п, в/ф, г/к) swapped;
 *  - `sign`: ь/ъ left out; `ts`: ц written тс (or тс written ц); `shch`: щ written ш, ш written ж;
 *    `ending`: -ий written -ый and the other way round;
 *  - `sound-and-slip`: a vowel by sound plus a left-out or doubled letter.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const BENCHMARKS = resolve(ROOT, 'tools/benchmarks');

interface NameCase {
  readonly set: string;
  readonly name: string;
  readonly expectedTargets: readonly string[];
}
const names = JSON.parse(
  readFileSync(resolve(BENCHMARKS, 'name-variant-queries.json'), 'utf8'),
) as {
  cases: readonly NameCase[];
  controls: readonly { id: string; kind: string; query: string }[];
};
const owner = JSON.parse(readFileSync(resolve(BENCHMARKS, 'owner-queries.json'), 'utf8')) as {
  queries: readonly { id: string; query: string }[];
};

const ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'];
const SOUND: Readonly<Record<string, string>> = { а: 'о', о: 'а', е: 'и', и: 'е', я: 'е', э: 'е' };
const UNRELATED = 'шкнмдлгбз';

function nextKey(letter: string): string | null {
  for (const row of ROWS) {
    const index = row.indexOf(letter);
    if (index < 0) continue;
    return row[index + 1] ?? row[index - 1] ?? null;
  }
  return null;
}

/** Deterministic position among the first `span` letters, spread over the names. */
function position(name: string, span: number): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 9973;
  return hash % span;
}

function replaceAt(word: string, index: number, letter: string): string {
  return word.slice(0, index) + letter + word.slice(index + 1);
}

function variants(word: string): Readonly<Record<string, string | null>> {
  const at = position(word, 3);
  const neighbour = nextKey(word[at] ?? '');
  const soundAt = [...word.slice(0, 4)].findIndex((letter) => letter in SOUND);
  const lateAt = word.length - 2;
  const late = nextKey(word[lateAt] ?? '');
  const unrelated = [...UNRELATED].find(
    (letter) =>
      letter !== word[at] &&
      letter !== neighbour &&
      letter !== nextKey(letter) &&
      !(letter in SOUND),
  );
  return {
    neighbour: neighbour ? replaceAt(word, at, neighbour) : null,
    sound: soundAt >= 0 ? replaceAt(word, soundAt, SOUND[word[soundAt] ?? ''] ?? '') : null,
    other: word.length >= 6 && unrelated ? replaceAt(word, at, unrelated) : null,
    late: late && word.length >= 6 ? replaceAt(word, lateAt, late) : null,
  };
}

const seen = new Set<string>();
const cases: {
  id: string;
  set: string;
  variant: string;
  tier?: 'hard';
  query: string;
  name: string;
  expectedTargets: readonly string[];
}[] = [];
for (const item of names.cases) {
  const key = `${item.set}|${item.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const words = item.name.toLowerCase().replaceAll('ё', 'е').split(/\s+/u);
  const index = words.findIndex((word) => /^[а-я]{5,}$/u.test(word));
  if (index < 0) continue;
  for (const [variant, typo] of Object.entries(variants(words[index] ?? ''))) {
    if (!typo) continue;
    const query = words.map((word, at) => (at === index ? typo : word)).join(' ');
    cases.push({
      id: `${item.set}-${variant}-${String(cases.length + 1).padStart(3, '0')}`,
      set: item.set,
      variant,
      query,
      name: item.name,
      expectedTargets: item.expectedTargets,
    });
  }
}

// ---- harder set (item 24, TYPO2) ----
const CYRILLIC_WORD = /^[а-я]+$/u;
const VOWEL_SOUND: Readonly<Record<string, string>> = { а: 'о', о: 'а', е: 'и', и: 'е', я: 'е' };
const VOICING: Readonly<Record<string, string>> = {
  з: 'с',
  с: 'з',
  д: 'т',
  т: 'д',
  б: 'п',
  п: 'б',
  в: 'ф',
  ф: 'в',
  г: 'к',
  к: 'г',
};

function hashOf(text: string): number {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 99991;
  return hash;
}

/** A deterministic position in `[low, high]` (clamped to a single value when the range is empty). */
function between(word: string, salt: string, low: number, high: number): number {
  if (high <= low) return low;
  return low + (hashOf(`${word}|${salt}`) % (high - low + 1));
}

function dropAt(word: string, index: number): string {
  return word.slice(0, index) + word.slice(index + 1);
}

function doubleAt(word: string, index: number): string {
  return word.slice(0, index + 1) + word.slice(index);
}

/** Positions of the letters (past the first) that have a sound-alike vowel. */
function vowelPositions(word: string): readonly number[] {
  return [...word].flatMap((letter, index) =>
    index >= 1 && index <= word.length - 2 && letter in VOWEL_SOUND ? [index] : [],
  );
}

type HardMake = (word: string) => string | null;

const HARD_VARIANTS: readonly {
  readonly variant: string;
  readonly minLength: number;
  readonly make: HardMake;
}[] = [
  {
    variant: 'mid',
    minLength: 6,
    make: (word) => {
      const at = between(word, 'mid', 3, word.length - 3);
      const key = nextKey(word[at] ?? '');
      return key ? replaceAt(word, at, key) : null;
    },
  },
  {
    variant: 'two-cheap',
    minLength: 7,
    make: (word) => {
      const half = Math.floor(word.length / 2);
      const first = between(word, 'two-a', 1, half - 1);
      const second = between(word, 'two-b', half + 1, word.length - 2);
      const left = nextKey(word[first] ?? '');
      const right = SOUND_KEYS(word[second] ?? '') ?? nextKey(word[second] ?? '');
      return left && right ? replaceAt(replaceAt(word, first, left), second, right) : null;
    },
  },
  {
    variant: 'two-full',
    minLength: 7,
    make: (word) => {
      const half = Math.floor(word.length / 2);
      const first = between(word, 'full-a', 1, half - 1);
      const second = between(word, 'full-b', half + 1, word.length - 2);
      const letterA = unrelatedTo(word[first] ?? '');
      const letterB = unrelatedTo(word[second] ?? '');
      return replaceAt(replaceAt(word, first, letterA), second, letterB);
    },
  },
  {
    variant: 'drop',
    minLength: 6,
    make: (word) => dropAt(word, between(word, 'drop', 2, word.length - 2)),
  },
  {
    variant: 'double',
    minLength: 6,
    make: (word) => {
      const at = between(word, 'double', 1, word.length - 2);
      return word[at] === word[at + 1] ? null : doubleAt(word, at);
    },
  },
  {
    variant: 'vowels',
    minLength: 6,
    make: (word) => {
      const positions = vowelPositions(word);
      if (positions.length < 2) return null;
      const first = positions[between(word, 'v-a', 0, positions.length - 2)] ?? 0;
      const rest = positions.filter((position) => position > first + 1);
      const second = rest[between(word, 'v-b', 0, rest.length - 1)];
      if (second === undefined) return null;
      return replaceAt(
        replaceAt(word, first, VOWEL_SOUND[word[first] ?? ''] ?? ''),
        second,
        VOWEL_SOUND[word[second] ?? ''] ?? '',
      );
    },
  },
  {
    variant: 'consonant',
    minLength: 5,
    make: (word) => {
      const pair = [...word].findIndex((letter, index) => index > 0 && letter === word[index - 1]);
      if (pair > 0 && !'аеиоуыэюя'.includes(word[pair] ?? '')) return dropAt(word, pair);
      const voicing = [...word].findIndex(
        (letter, index) => index >= 2 && index <= word.length - 2 && letter in VOICING,
      );
      return voicing > 0 ? replaceAt(word, voicing, VOICING[word[voicing] ?? ''] ?? '') : null;
    },
  },
  {
    variant: 'sign',
    minLength: 5,
    make: (word) => {
      const at = [...word].findIndex((letter, index) => index > 0 && 'ьъ'.includes(letter));
      return at > 0 ? dropAt(word, at) : null;
    },
  },
  {
    variant: 'ts',
    minLength: 5,
    make: (word) => {
      if (word.includes('тс')) return word.replace('тс', 'ц');
      return word.slice(1).includes('ц') ? word[0] + word.slice(1).replace('ц', 'тс') : null;
    },
  },
  {
    variant: 'shch',
    minLength: 5,
    make: (word) => {
      if (word.slice(1).includes('щ')) return word[0] + word.slice(1).replace('щ', 'ш');
      return word.slice(1).includes('ш') ? word[0] + word.slice(1).replace('ш', 'ж') : null;
    },
  },
  {
    variant: 'ending',
    minLength: 7,
    make: (word) => {
      if (word.endsWith('ый')) return `${word.slice(0, -2)}ий`;
      if (word.endsWith('ий')) return `${word.slice(0, -2)}ый`;
      return null;
    },
  },
  {
    variant: 'sound-and-slip',
    minLength: 7,
    make: (word) => {
      const positions = vowelPositions(word);
      const at = positions[between(word, 'sas-a', 0, positions.length - 1)];
      if (at === undefined) return null;
      const sounded = replaceAt(word, at, VOWEL_SOUND[word[at] ?? ''] ?? '');
      const other = between(word, 'sas-b', 2, word.length - 2);
      if (Math.abs(other - at) < 2) return null;
      return hashOf(word) % 2 === 0 ? dropAt(sounded, other) : doubleAt(sounded, other);
    },
  },
];

/** The letter that sounds alike unstressed (a vowel pair or a voicing pair), or null. */
function SOUND_KEYS(letter: string): string | null {
  return VOWEL_SOUND[letter] ?? VOICING[letter] ?? null;
}

/** A letter unrelated to `letter`: not a neighbouring key and not a sound-alike. */
function unrelatedTo(letter: string): string {
  const next = nextKey(letter);
  return (
    [...'шкнмдлгбзчфх'].find(
      (candidate) =>
        candidate !== letter &&
        candidate !== next &&
        candidate !== nextKey(next ?? '') &&
        SOUND_KEYS(letter) !== candidate &&
        !(letter in VOWEL_SOUND && candidate in VOWEL_SOUND),
    ) ?? 'ш'
  );
}

const hardSeen = new Set<string>();
for (const item of names.cases) {
  const key = `${item.set}|${item.name}`;
  if (hardSeen.has(key)) continue;
  hardSeen.add(key);
  const words = item.name.toLowerCase().replaceAll('ё', 'е').split(/\s+/u);
  for (const { variant, minLength, make } of HARD_VARIANTS) {
    for (const [index, word] of words.entries()) {
      if (word.length < minLength || !CYRILLIC_WORD.test(word)) continue;
      const typo = make(word);
      if (!typo || typo === word) continue;
      cases.push({
        id: `${item.set}-hard-${variant}-${String(cases.length + 1).padStart(4, '0')}`,
        set: item.set,
        variant,
        tier: 'hard',
        query: words.map((other, at) => (at === index ? typo : other)).join(' '),
        name: item.name,
        expectedTargets: item.expectedTargets,
      });
      break;
    }
  }
}

// Nonsense words: pronounceable strings that name nothing. They are no controls (a long one may lie
// two edits from a real name); the runner reports how many of them a correction would rewrite.
const nonsense: string[] = [];
{
  const consonants = 'бвгдзклмнпрстфхцчш';
  const vowels = 'аеиоуы';
  let seed = 20261031;
  const next = (span: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % span;
  };
  for (let count = 0; count < 200; count += 1) {
    const length = 6 + (count % 5);
    let word = '';
    for (let index = 0; index < length; index += 1)
      word += (index % 2 === 0 ? consonants : vowels)[
        next((index % 2 === 0 ? consonants : vowels).length)
      ];
    nonsense.push(word);
  }
}

const controls = [
  ...names.controls.map((control) => ({ id: control.id, query: control.query })),
  ...owner.queries.map((query) => ({ id: `owner-${query.id}`, query: query.query })),
];

writeFileSync(
  resolve(BENCHMARKS, 'typo-queries.json'),
  `${JSON.stringify({ schemaVersion: 2, cases, controls, nonsense }, null, 2)}\n`,
);
console.log(`typo-queries.json: ${cases.length} cases, ${controls.length} controls`);
