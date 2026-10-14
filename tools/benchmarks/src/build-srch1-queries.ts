// SRCH1: builds tools/benchmarks/srch1-queries.json from the drug data the app ships.
//
//   brand  trade names of the ГРЛС instruction documents of the comparison index
//          (apps/app/src/features/drug-comparison/data/comparison-index.json: `documents[].t`) that are
//          NOT the name of their own substance card («Аспирин», «Нурофен», «Валидол», «Анальгин»):
//          the commonest 150 by number of registered documents plus an even sample of 150 more.
//          Expected: the substance card(s) of the documents that carry the name.
//   inn    the names of the 150 substance cards with the most trade names (single-substance cards).
//          Expected: that card, first.
//
// Deterministic (sorted, no randomness). Run: bun tools/benchmarks/src/build-srch1-queries.ts, then
// bunx biome format --write tools/benchmarks/srch1-queries.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ComparisonIndexAsset } from '../../../apps/app/src/features/drug-comparison/comparison-index';
import { REPOSITORY_ROOT } from './real-corpus';

const asset = JSON.parse(
  readFileSync(
    resolve(REPOSITORY_ROOT, 'apps/app/src/features/drug-comparison/data/comparison-index.json'),
    'utf8',
  ),
) as ComparisonIndexAsset;

const normalize = (text: string): string =>
  text
    .replaceAll(/[®™]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');

const cardNames = new Set(asset.cards.map((card) => normalize(card.n)));
const byName = new Map<
  string,
  { display: string; documents: number; cards: Map<string, number> }
>();
for (const document of Object.values(asset.documents)) {
  if (!document.t) continue;
  const key = normalize(document.t);
  if (key.length < 4 || !/^[а-яa-z0-9 \-.]+$/u.test(key) || cardNames.has(key)) continue;
  const entry = byName.get(key) ?? {
    display: document.t.replaceAll(/[®™]/gu, '').replaceAll(/\s+/gu, ' ').trim(),
    documents: 0,
    cards: new Map<string, number>(),
  };
  entry.documents += 1;
  for (const index of document.c) {
    const slug = asset.cards[index]?.s;
    if (slug) entry.cards.set(slug, (entry.cards.get(slug) ?? 0) + 1);
  }
  byName.set(key, entry);
}
const brands = [...byName.entries()]
  .filter(([, entry]) => entry.cards.size > 0 && entry.cards.size <= 2)
  .toSorted((a, b) => b[1].documents - a[1].documents || a[0].localeCompare(b[0], 'ru'));
const top = brands.slice(0, 150);
const rest = brands.slice(150);
const step = Math.max(1, Math.floor(rest.length / 150));
const sampled = rest.filter((_, index) => index % step === 0).slice(0, 150);

// Brands a doctor types every day (the QA pass named the first six); the expected card is whatever the
// data says the name stands for.
const NAMED = [
  'Аспирин',
  'Нурофен',
  'Арбидол',
  'Амоксиклав',
  'Ксарелто',
  'Эналаприл-ФПО',
  'Эликвис',
  'Мезим',
  'Но-шпа',
  'Цитрамон',
  'Панадол',
  'Супрастин',
  'Кардиомагнил',
  'Конкор',
  'Престариум',
  'Омез',
  'Нексиум',
  'Глюкофаж',
  'Лазолван',
  'Беродуал',
  'Ингаверин',
  'Кагоцел',
  'Тамифлю',
  'Зиртек',
  'Лоратадин-Акрихин',
];
const named = NAMED.flatMap((name) => {
  const entry = byName.get(normalize(name));
  return entry ? [[normalize(name), { ...entry, display: name }] as const] : [];
});
const topKeys = new Set([...top, ...sampled].map(([key]) => key));
const queries = [
  ...[...named.filter(([key]) => !topKeys.has(key)), ...top, ...sampled].map(
    ([, entry], index) => ({
      id: `brand-${String(index + 1).padStart(3, '0')}`,
      kind: 'brand' as const,
      query: entry.display,
      expectedSlugs: [...entry.cards.keys()],
      documents: entry.documents,
    }),
  ),
];

// Single-substance cards (no «+»), named by the registry, with the most trade names.
const inn = asset.cards
  .filter((card) => !card.n.includes('+') && /^[А-ЯЁ][А-ЯЁ -]+$/u.test(card.n) && card.t >= 10)
  .toSorted((a, b) => b.t - a.t || a.n.localeCompare(b.n, 'ru'))
  .slice(0, 150)
  .map((card, index) => ({
    id: `inn-${String(index + 1).padStart(3, '0')}`,
    kind: 'inn' as const,
    query: card.n.toLocaleLowerCase('ru-RU'),
    expectedSlugs: [card.s],
    documents: card.t,
  }));

// Text with no real word in it: the search answers «Ничего не найдено», not its nearest fuzzy hit.
const NONSENSE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  "'; ;; --",
  '!!!@@@###',
  ';;;;;;;;',
  '%%%%%%',
  'asdfghjkl',
  'qwertyuiop',
  'zzzxxqqww',
  'ъъъъъъ',
  'ыыыыыы',
  'щщщщщщ',
  'фывапролдж',
  'xkcdqzvbn',
  'ёёёёё',
  '1234567890123',
];
// Real queries that must keep finding something (names, codes, Latin terms, slips).
const CONTROLS = [
  'аспирин',
  'J05',
  'пневмония',
  'ибупрофен',
  'пневмания',
  'оменция',
  'ьуеащкьшт',
  'цефтриаксн',
  'ВИЧ',
  'E11',
  'гипертония',
  'Mycoplasma pneumoniae',
  'бронхит у детей',
  'амоксицилин',
  'астма',
  'сахарный диабет',
  'инфаркт миокарда',
  'Q86.2',
  'метформин',
];
// Common substance words that homeopathic mixtures also contain (checked against the data's group
// «гомеопатическое средство»): the substance's own cards come before the mixtures.
const HOMEOPATHY = [
  'фосфор',
  'ртуть',
  'сера',
  'кальций',
  'мышьяк',
  'железо',
  'калий',
  'магний',
  'цинк',
  'натрий',
  'золото',
  'серебро',
  'йод',
  'медь',
  'свинец',
];

const output = resolve(REPOSITORY_ROOT, 'tools/benchmarks/srch1-queries.json');
writeFileSync(
  output,
  `${JSON.stringify({ description: 'SRCH1: brand and INN queries derived from the shipped comparison index.', queries: [...queries, ...inn], nonsense: NONSENSE, controls: CONTROLS, homeopathy: HOMEOPATHY }, null, 1)}\n`,
);
console.log(`brands ${queries.length}, inn ${inn.length} → ${output}`);
