/**
 * Lists the active substances that the app's drug data (ЕСКЛП МНН cards) names, with the level-5
 * ATC codes the cards carry and the НСИ «АТХ» names (Russian and English) of those codes.
 *
 *   bun tools/compounds/extract-actives.ts [--esklp DIR] [--atc FILE] [--out FILE]
 *
 * Inputs (read only): `data/build/release-esklp/*.db`, `data/raw/nsi/atc/<version>/rows.json`.
 * Output (gitignored): `data/raw/compounds/actives-universe.json`.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeCompoundName } from '../../apps/app/src/features/medications/compounds/compound-name';

const ROOT = join(import.meta.dirname, '..', '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function latestAtcRows(): string {
  const base = join(ROOT, 'data/raw/nsi/atc');
  const [latest] = readdirSync(base)
    .filter((name) => /^v\d/u.test(name) && existsSync(join(base, name, 'rows.json')))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  if (!latest) throw new Error('no НСИ АТХ rows under data/raw/nsi/atc');
  return join(base, latest, 'rows.json');
}

interface Card {
  standardizedInn: string;
  inn: string[];
  componentInns?: string[];
  atcCodes?: string[];
}

interface AtcRow {
  code: string;
  ru: string;
  en: string;
}

const esklpDir = argument('esklp', join(ROOT, 'data/build/release-esklp'));
const atcFile = argument('atc', latestAtcRows());
const outFile = argument('out', join(ROOT, 'data/raw/compounds/actives-universe.json'));

const lower = (text: string) =>
  text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();

const atcRows: AtcRow[] = (
  JSON.parse(readFileSync(atcFile, 'utf8')) as { column: string; value: string | null }[][]
)
  .map((row) => {
    const get = (column: string) => row.find((cell) => cell.column === column)?.value ?? '';
    return { code: get('ATC_CODE'), ru: get('ATC_NAME'), en: get('ATC_NAME_ENG') };
  })
  .filter((row) => row.code.length === 7);
const atcByRu = new Map<string, AtcRow[]>();
for (const row of atcRows) {
  const key = lower(row.ru);
  atcByRu.set(key, [...(atcByRu.get(key) ?? []), row]);
}

interface Substance {
  ru: string;
  cards: number;
  /** Cards that name this substance alone (not a combination). */
  singleCards: number;
  atc: Set<string>;
  synonyms: Set<string>;
}

const substances = new Map<string, Substance>();

function substance(name: string): Substance {
  const key = lower(name);
  const found = substances.get(key) ?? {
    ru: key,
    cards: 0,
    singleCards: 0,
    atc: new Set<string>(),
    synonyms: new Set<string>(),
  };
  substances.set(key, found);
  return found;
}

for (const file of readdirSync(esklpDir).filter((name) => name.endsWith('.db'))) {
  const db = new Database(join(esklpDir, file), { readonly: true });
  for (const { metadata_json } of db
    .query<{ metadata_json: string }, []>('SELECT metadata_json FROM documents')
    .all()) {
    const card = JSON.parse(metadata_json) as Card;
    const components = card.componentInns?.length ? card.componentInns : [];
    const single = components.length === 0;
    const names = single ? [card.standardizedInn] : components;
    for (const name of names) {
      const entry = substance(name);
      entry.cards += 1;
      if (single) {
        entry.singleCards += 1;
        for (const code of card.atcCodes ?? []) if (code.length === 7) entry.atc.add(code);
        for (const synonym of card.inn) {
          if (synonym !== '~' && lower(synonym) !== entry.ru) entry.synonyms.add(lower(synonym));
        }
      }
    }
  }
  db.close();
}

const output = [...substances.values()]
  .map((entry) => {
    // A Russian ATC name equal to the substance gives a code (and the English name) that the
    // card itself lacks; several codes (routes) are all kept.
    const named = atcByRu.get(entry.ru) ?? [];
    return {
      ru: entry.ru,
      key: normalizeCompoundName(entry.ru),
      cards: entry.cards,
      singleCards: entry.singleCards,
      atcFromCards: [...entry.atc].sort(),
      atcFromNames: named.map((row) => row.code).sort(),
      en: [...new Set(named.map((row) => row.en.toLowerCase()).filter(Boolean))].sort(),
      synonyms: [...entry.synonyms].sort(),
    };
  })
  .sort((a, b) => b.cards - a.cards || a.ru.localeCompare(b.ru, 'ru'));

mkdirSync(join(outFile, '..'), { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ atcSource: atcFile, substances: output })}\n`);
console.error(
  `${output.length} substances; ${output.filter((s) => s.atcFromCards.length || s.atcFromNames.length).length} with an ATC code`,
);
