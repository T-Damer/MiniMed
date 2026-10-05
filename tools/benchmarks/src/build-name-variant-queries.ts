/**
 * Builds `tools/benchmarks/name-variant-queries.json` (roadmap item 3, S3): name queries typed on
 * the wrong keyboard layout or in Latin letters, generated deterministically from real names in the
 * released databases, plus negative controls that must not change.
 *
 *   bun tools/benchmarks/src/build-name-variant-queries.ts
 *
 * Name sources (evenly spaced sample of the sorted ids, no randomness):
 *  - `mnn`: single-word МНН titles of the core medication pointers (ЕСКЛП);
 *  - `trade`: Allmed drug titles with their real Latin name (`nameLat`, medications.db);
 *  - `disease`: one- or two-word titles of core disease pointers (reference articles);
 *  - `guideline`: one- or two-word titles of core КР pointers.
 * Variants per name:
 *  - `layout`: the Russian name typed on the English layout («vtnajhvby»);
 *  - `latin`: the real Latin name of a trade name («Nurofen») — ground truth, not generated;
 *  - `latin-passport` / `latin-inn`: two independent mechanical Latinisations of a Russian name
 *    (passport-style «ts/kh/y» and INN-style «c/h/i»); synthetic, and `latin-inn` is the closest
 *    to how people spell drug names;
 *  - `layout-latin`: a real Latin name typed on the Russian layout («ьуеащкьшт»).
 * Controls: Latin/English medical terms and codes plus correctly typed Russian names, whose search
 * must be identical with and without the fallback.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ReadonlyDatabase {
  query(sql: string): { all(...parameters: string[]): unknown[] };
}
// Bun's SQLite, loaded dynamically so the package typechecks without Bun's type definitions.
const { Database } = (await import('bun:sqlite' as string)) as unknown as {
  Database: new (path: string, options: { readonly: boolean }) => ReadonlyDatabase;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTENT = resolve(ROOT, 'apps/app/public/content');
const SAMPLE = 60;

const RU_ON_EN: Readonly<Record<string, string>> = {
  й: 'q',
  ц: 'w',
  у: 'e',
  к: 'r',
  е: 't',
  н: 'y',
  г: 'u',
  ш: 'i',
  щ: 'o',
  з: 'p',
  х: '[',
  ъ: ']',
  ф: 'a',
  ы: 's',
  в: 'd',
  а: 'f',
  п: 'g',
  р: 'h',
  о: 'j',
  л: 'k',
  д: 'l',
  ж: ';',
  э: "'",
  я: 'z',
  ч: 'x',
  с: 'c',
  м: 'v',
  и: 'b',
  т: 'n',
  ь: 'm',
  б: ',',
  ю: '.',
  ё: '`',
};
const EN_ON_RU: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RU_ON_EN).map(([ru, en]) => [en, ru]),
);
const typeOn = (text: string, table: Readonly<Record<string, string>>): string =>
  [...text].map((character) => table[character] ?? character).join('');

const PASSPORT: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
/** INN-style: ц→c (ci/ce), к→c before a/o/u/l/r, х→h (chl- before л/р), и→i, й→y, ь dropped. */
function latinInn(name: string): string {
  const letters = [...name];
  return letters
    .map((letter, index) => {
      const next = letters[index + 1] ?? '';
      if (letter === 'ц') return 'c';
      if (letter === 'к') return 'аоулр'.includes(next) ? 'c' : 'k';
      if (letter === 'х') return 'лр'.includes(next) ? 'ch' : 'h';
      if (letter === 'э') return 'e';
      return PASSPORT[letter] ?? letter;
    })
    .join('');
}
const latinPassport = (name: string): string =>
  [...name].map((letter) => PASSPORT[letter] ?? letter).join('');

interface Row {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly nameLat?: string;
}
const evenly = <T>(rows: readonly T[], count: number): readonly T[] =>
  rows.length <= count
    ? rows
    : Array.from(
        { length: count },
        (_, index) => rows[Math.floor((index * rows.length) / count)] as T,
      );
const cyrillicName = (title: string, maxWords: number): string | null => {
  const clean = title
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/\s*\(.*$/u, '')
    .trim();
  const words = clean.split(/\s+/u);
  return words.length <= maxWords && /^[а-я]+(?:[ -][а-я]+)*$/u.test(clean) && clean.length >= 6
    ? clean
    : null;
};

const core = new Database(resolve(CONTENT, 'core.db'), { readonly: true });
const pointers = (family: string, entityType: string, idLike = '%'): Row[] =>
  (
    core
      .query(
        `SELECT id, title, json_extract(metadata_json,'$.targetDocumentId') AS target FROM documents
         WHERE json_extract(metadata_json,'$.catalogFamily') = ? AND json_extract(metadata_json,'$.entityType') = ?
           AND id LIKE ? ORDER BY id`,
      )
      .all(family, entityType, idLike) as { id: string; title: string; target: string }[]
  ).map((row) => ({ id: row.id, title: row.title, target: row.target }));

const medications = new Database(resolve(CONTENT, 'medications.db'), { readonly: true });
const trade = (
  medications
    .query(
      `SELECT id, title, json_extract(metadata_json,'$.nameLat') AS nameLat FROM documents
       WHERE json_extract(metadata_json,'$.nameLat') IS NOT NULL ORDER BY id`,
    )
    .all() as { id: string; title: string; nameLat: string }[]
).map((row) => ({ id: row.id, title: row.title, target: row.id, nameLat: row.nameLat }));

interface Case {
  id: string;
  set: string;
  variant: string;
  query: string;
  name: string;
  expectedTargets: string[];
}
const cases: Case[] = [];
const add = (
  set: string,
  variant: string,
  index: number,
  query: string,
  row: Row,
  name: string,
) => {
  if (query.trim().toLowerCase() === name) return;
  cases.push({
    id: `${set}-${variant}-${String(index + 1).padStart(2, '0')}`,
    set,
    variant,
    query,
    name,
    expectedTargets: [row.target],
  });
};

const sources: { set: string; rows: readonly (Row & { name: string })[] }[] = [
  {
    set: 'mnn',
    rows: pointers('medication', 'medication').flatMap((row) => {
      const name = cyrillicName(row.title, 1);
      return name && !row.title.includes('+') ? [{ ...row, name }] : [];
    }),
  },
  {
    set: 'trade',
    rows: trade.flatMap((row) => {
      const name = cyrillicName(row.title, 1);
      return name && /^[A-Za-z][A-Za-z -]*$/u.test(row.nameLat) ? [{ ...row, name }] : [];
    }),
  },
  {
    set: 'disease',
    rows: pointers('reference', 'disease', '%krasotaimedicina%').flatMap((row) => {
      const name = cyrillicName(row.title, 2);
      return name ? [{ ...row, name }] : [];
    }),
  },
  {
    set: 'guideline',
    rows: pointers('clinical', 'disease').flatMap((row) => {
      const name = cyrillicName(row.title, 2);
      return name ? [{ ...row, name }] : [];
    }),
  },
];
for (const { set, rows } of sources) {
  for (const [index, row] of evenly(rows, SAMPLE).entries()) {
    add(set, 'layout', index, typeOn(row.name, RU_ON_EN), row, row.name);
    if (set === 'trade' && row.nameLat) {
      const latin = row.nameLat.toLowerCase();
      add(set, 'latin', index, latin, row, row.name);
      add(set, 'layout-latin', index, typeOn(latin, EN_ON_RU), row, row.name);
    } else {
      add(set, 'latin-passport', index, latinPassport(row.name), row, row.name);
      add(set, 'latin-inn', index, latinInn(row.name), row, row.name);
    }
  }
}

/** Real Latin/English terms and codes; they either match as typed or must be left alone. */
const LATIN_CONTROLS = [
  'J18.9',
  'I10',
  'E11.9',
  'K29.3',
  'N39.0',
  'ЭКГ',
  'ECG',
  'HbA1c',
  'COVID',
  'COVID-19',
  'ВИЧ',
  'HIV',
  'SARS',
  'TNM',
  'BRCA1',
  'EGFR',
  'PCR',
  'ПЦР',
  'МРТ',
  'MRI',
  'COPD',
  'ХОБЛ',
  'INR',
  'МНО',
  'TSH',
  'ТТГ',
  'HELLP',
  'HPV',
  'ВПЧ',
  'HLA-B27',
  'Helicobacter pylori',
  'E. coli',
  'vitamin D',
  'vitamin B12',
  'omega-3',
  'NSAID',
  'ACE inhibitor',
  'Parkinson',
  'Alzheimer',
  'Crohn',
  'Down syndrome',
  'ICD-10',
  'ATC',
  'SOFA',
  'APGAR',
  'Glasgow',
  'CHA2DS2-VASc',
  'NIHSS',
  'qSOFA',
  'Candida albicans',
  'Clostridium difficile',
  'Staphylococcus aureus',
  'Streptococcus',
  'Hallux valgus',
  'TORCH',
  'DOTS',
  'DVT',
  'GERD',
  'IBS',
  'ADHD',
  'PTSD',
  'BMI',
  'ИМТ',
  'ОРВИ',
  'СОЭ',
  'ОАК',
];
const controls = [
  ...LATIN_CONTROLS.map((query, index) => ({
    id: `control-term-${String(index + 1).padStart(2, '0')}`,
    kind: 'term',
    query,
  })),
  ...sources.flatMap(({ set, rows }) =>
    evenly(rows, 25).map((row, index) => ({
      id: `control-name-${set}-${String(index + 1).padStart(2, '0')}`,
      kind: 'name',
      query: row.name,
    })),
  ),
];

const output = resolve(import.meta.dirname, '../name-variant-queries.json');
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      id: 'name-variant-queries-2026-10-05',
      description:
        'Keyboard-layout and Latin-spelling variants of real names (S3 item 3), generated by build-name-variant-queries.ts from core.db and medications.db; controls must keep identical results with the fallback on and off.',
      sample: SAMPLE,
      cases,
      controls,
    },
    null,
    1,
  )}\n`,
);
const counts: Record<string, number> = {};
for (const item of cases)
  counts[`${item.set}/${item.variant}`] = (counts[`${item.set}/${item.variant}`] ?? 0) + 1;
console.log(counts, 'controls', controls.length);
