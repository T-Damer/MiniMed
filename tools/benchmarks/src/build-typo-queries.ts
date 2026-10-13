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

const controls = [
  ...names.controls.map((control) => ({ id: control.id, query: control.query })),
  ...owner.queries.map((query) => ({ id: `owner-${query.id}`, query: query.query })),
];

writeFileSync(
  resolve(BENCHMARKS, 'typo-queries.json'),
  `${JSON.stringify({ schemaVersion: 1, cases, controls }, null, 2)}\n`,
);
console.log(`typo-queries.json: ${cases.length} cases, ${controls.length} controls`);
