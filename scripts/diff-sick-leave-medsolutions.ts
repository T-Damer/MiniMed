/**
 * Compares `apps/app/src/features/sick-leave/sick-leave-periods.json` (built from the official letter)
 * with the structured copy MedSolutions ships (`estimated_periods.db`, local-only cross-check data).
 * Prints, per ICD-10 code, where the two disagree on the title or the period values; the letter wins.
 *
 *   bun scripts/diff-sick-leave-medsolutions.ts [path to estimated_periods.db]
 */
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';

const DEFAULT_DATABASE =
  '/Users/d/Projects/Personal/MiniMed/data/raw/medsolutions-spravochnik-vracha/databases/estimated_periods.db';
const ASSET = 'apps/app/src/features/sick-leave/sick-leave-periods.json';

type Period = readonly [string, string, readonly number[]];
type Entry = readonly [
  string,
  string,
  number,
  number,
  readonly Period[],
  readonly number[],
  string,
];

const asset = JSON.parse(readFileSync(ASSET, 'utf8')) as { readonly entries: readonly Entry[] };
const database = new Database(process.argv[2] ?? DEFAULT_DATABASE, { readonly: true });
const items = database
  .query(
    "select id, code, title from estimated_periods where rows is not null and rows <> '' order by id",
  )
  .all() as { id: number; code: string; title: string }[];
const details = database
  .query('select period, estimated_period_id as id from estimated_period_details order by id')
  .all() as { period: string | null; id: number }[];

/** Period text without footnote marks, dash variants, spacing and the unit spelling. */
const periodKey = (value: string): string =>
  value
    .replace(/<\*+>|\*/gu, '')
    .replace(/[–—]/gu, '-')
    .replace(/\s+/gu, '')
    .replace(/мес\.?/gu, 'мес')
    .replace(/,?возможноМСЭ/u, ',МСЭ');
const codeKey = (value: string): string => value.replace(/[,.-]+$/u, '').replace(',', '.');
const titleKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const ms = new Map<string, { periods: string[]; titles: string[] }>();
for (const item of items) {
  const key = codeKey(item.code);
  const slot = ms.get(key) ?? { periods: [], titles: [] };
  slot.titles.push(item.title);
  for (const row of details)
    if (row.id === item.id && row.period) slot.periods.push(periodKey(row.period));
  ms.set(key, slot);
}
const official = new Map<string, { periods: string[]; titles: string[] }>();
for (const entry of asset.entries) {
  const key = codeKey(entry[0]);
  const slot = official.get(key) ?? { periods: [], titles: [] };
  slot.titles.push(entry[1]);
  for (const period of entry[4]) if (period[1]) slot.periods.push(periodKey(period[1]));
  official.set(key, slot);
}

const sorted = (values: readonly string[]): string => [...values].sort().join(' ');
console.log(`official codes ${String(official.size)}, MedSolutions codes ${String(ms.size)}`);
for (const [code, slot] of official) {
  const other = ms.get(code);
  if (!other) {
    console.log(`OFFICIAL-ONLY ${code}  ${slot.titles.join(' / ').slice(0, 90)}`);
    continue;
  }
  if (sorted(slot.periods) !== sorted(other.periods))
    console.log(
      `PERIODS ${code}  official: ${sorted(slot.periods)}  | medsolutions: ${sorted(other.periods)}`,
    );
  const left = slot.titles.map(titleKey).sort().join('|');
  const right = other.titles.map(titleKey).sort().join('|');
  if (left !== right)
    console.log(
      `TITLE ${code}  official: ${slot.titles.join(' / ')}  | medsolutions: ${other.titles.join(' / ')}`,
    );
}
for (const [code, slot] of ms)
  if (!official.has(code))
    console.log(`MEDSOLUTIONS-ONLY ${code}  ${slot.titles.join(' / ').slice(0, 90)}`);
