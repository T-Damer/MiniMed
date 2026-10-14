// ATC5: drugs found by an ATC code through the code the app runs (ScopedMedicalCore «Все» over
// MedicalCore with the app's drug directory) on the real corpus. The queries are generated from the
// drug directory itself (the comparison index), so nothing is hand-labelled:
//   1. every full code of every card finds the card (limit 50);
//   2. the agreed code beside a registry stub (ATC3) shows both codes, found under either;
//   3. a group prefix returns only drugs whose code begins with it;
//   4. the same code typed in lower case, with spaces, with Cyrillic look-alikes or with the Russian
//      layout gives the same drugs (the text hits behind them may differ);
//   5. words and short codes («ВИЧ», «С3», «парацетамол») never produce a code match.
//
//   bun src/run-atc-queries.ts [--check]
import { latinKeyOfRussianLetter } from '@localmed/search-lexical';
import { loadAtcDirectoryEntries } from '../../../apps/app/src/features/drug-comparison/comparison-atc-directory';
import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const check = process.argv.includes('--check');
const { core, target, documents } = await openRealCorpus({ companions: false });
const scoped = new ScopedMedicalCore(core, 'all');
const directory = await loadAtcDirectoryEntries();

async function search(query: string, limit = 50) {
  const result = await scoped.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(`${query}: ${result.error.message}`);
  return result.value;
}

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
  if (failures.length <= 30) console.log(`FAIL ${message}`);
}

// 1. Every full code finds its card.
let fullTotal = 0;
let fullFound = 0;
let fullTop5 = 0;
let notInCore = 0;
const coreTargets = new Set([...documents.keys()].map((id) => target(id)));
const started = performance.now();
const fullCodes: { code: string; id: string }[] = [];
for (const entry of directory) {
  if (!coreTargets.has(entry.id)) {
    notInCore += 1;
    continue;
  }
  for (const code of entry.codes) if (code.length === 7) fullCodes.push({ code, id: entry.id });
}
for (const { code, id } of fullCodes) {
  fullTotal += 1;
  const response = await search(code);
  const ids = response.groups.map((group) => target(group.documentId));
  const position = ids.indexOf(id);
  if (position >= 0) fullFound += 1;
  else fail(`full code ${code} did not find ${id}`);
  if (position >= 0 && position < 5) fullTop5 += 1;
  const own = response.groups.find((group) => target(group.documentId) === id)?.atcMatch;
  if (position >= 0 && own === undefined) fail(`full code ${code}: ${id} has no atcMatch`);
}
const elapsed = performance.now() - started;

// 2. The agreed pairs.
let pairs = 0;
let pairsOk = 0;
for (const entry of directory) {
  for (const pair of entry.agreed ?? []) {
    if (!coreTargets.has(entry.id)) continue;
    pairs += 1;
    let ok = true;
    for (const query of [pair.code, pair.registry]) {
      const group = (await search(query, 100)).groups.find(
        (item) => target(item.documentId) === entry.id,
      );
      if (group?.atcMatch?.code !== pair.code || group.atcMatch.registryCode !== pair.registry) {
        ok = false;
        fail(
          `pair ${pair.code}/${pair.registry}: ${query} shows ${JSON.stringify(group?.atcMatch)}`,
        );
      }
    }
    if (ok) pairsOk += 1;
  }
}

// 3. Prefixes return only drugs under them.
const prefixes = new Set<string>();
for (const entry of directory)
  for (const code of entry.codes) for (const n of [3, 4, 5]) prefixes.add(code.slice(0, n));
let prefixTotal = 0;
let prefixBad = 0;
for (const prefix of [...prefixes].filter((_, index) => index % 7 === 0)) {
  prefixTotal += 1;
  const matched = (await search(prefix, 20)).groups.filter((group) => group.atcMatch);
  if (matched.length === 0) {
    // A prefix whose drugs are not in the core has no group; not a miss of the lookup.
    continue;
  }
  for (const group of matched) {
    const entry = directory.find((item) => item.id === target(group.documentId));
    if (!entry?.codes.some((code) => code.startsWith(prefix))) {
      prefixBad += 1;
      fail(`prefix ${prefix} returned ${group.documentId}`);
    }
  }
}

// 4. Typing variants give the same first group.
const LOOKALIKE: Readonly<Record<string, string>> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};
const LAYOUT: Record<string, string> = {};
for (let code = 0x430; code <= 0x44f; code += 1) {
  const letter = String.fromCharCode(code);
  const key = latinKeyOfRussianLetter(letter);
  if (key) LAYOUT[key.toUpperCase()] = letter;
}
const typed = (code: string, how: 'lower' | 'spaced' | 'lookalike' | 'layout'): string | null => {
  switch (how) {
    case 'lower':
      return code.toLowerCase();
    case 'spaced':
      return `${code.slice(0, 3)} ${code.slice(3, 5)} ${code.slice(5)}`.trim();
    case 'lookalike': {
      const converted = [...code].map((char) => LOOKALIKE[char] ?? char);
      return converted.every((char, index) => char === code[index] || /[А-Я]/u.test(char))
        ? converted.join('')
        : null;
    }
    case 'layout':
      return [...code].map((char) => LAYOUT[char] ?? char).join('');
  }
};
let variantTotal = 0;
let variantSame = 0;
for (const { code } of fullCodes.filter((_, index) => index % 40 === 0)) {
  const codeGroups = async (query: string) =>
    (await search(query, 10)).groups
      .filter((group) => group.atcMatch)
      .map((group) => group.documentId);
  const base = await codeGroups(code);
  for (const how of ['lower', 'spaced', 'lookalike', 'layout'] as const) {
    const query = typed(code, how);
    if (!query) continue;
    variantTotal += 1;
    const got = await codeGroups(query);
    if (JSON.stringify(got) === JSON.stringify(base)) variantSame += 1;
    else fail(`${how} variant «${query}» of ${code} differs from the plain code`);
  }
}

// 5. Words and short codes are no code lookups.
const negatives = [
  'ВИЧ',
  'С3',
  'В12 ',
  'парацетамол',
  'ибупрофен 200',
  'J05 ацикловир',
  'ДИАБЕТ',
  'Д3',
];
let negativeBad = 0;
for (const query of negatives) {
  const response = await search(query, 10).catch(() => null);
  if (response?.groups.some((group) => group.atcMatch)) {
    negativeBad += 1;
    fail(`«${query}» produced a code match`);
  }
}

console.log(
  JSON.stringify(
    {
      directoryCards: directory.length,
      cardsMountedInCore: directory.length - notInCore,
      fullCodes: {
        queries: fullTotal,
        found: fullFound,
        top5: fullTop5,
        meanMs: Number((elapsed / Math.max(1, fullTotal)).toFixed(1)),
      },
      agreedPairs: { pairs, bothCodesShown: pairsOk },
      prefixes: { queries: prefixTotal, wrongDrugs: prefixBad },
      variants: { queries: variantTotal, sameAsPlain: variantSame },
      negatives: { queries: negatives.length, withCodeMatch: negativeBad },
    },
    null,
    2,
  ),
);
if (check && failures.length > 0) {
  console.error(`${failures.length} failures`);
  process.exit(1);
}
