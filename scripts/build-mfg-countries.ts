/**
 * Builds the manufacturing-country asset of the drug screens from the ГРЛС registry catalog
 * (`catalog-<date>.json`, made by `collect_official_grls_registry`): registration number → country
 * of manufacture, with the registry fact the country rests on (see
 * `apps/app/src/features/medications/mfg-country-source.ts`).
 * Output: `apps/app/src/features/medications/mfg-countries.json`, a lazy chunk.
 *
 *   bun scripts/build-mfg-countries.ts [data/raw/official-grls-registry/catalog-02.10.2026.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MFG_BASES,
  type MfgBasis,
  normalizeRegistrationKey,
} from '../apps/app/src/features/medications/mfg-country';
import { resolveManufacturingCountries } from '../apps/app/src/features/medications/mfg-country-source';

interface RegistryRecord {
  readonly registrationNumber: string;
  readonly status: string;
  readonly manufacturer: string | null;
  readonly holderCountry: string | null;
}

interface RegistryCatalog {
  readonly sourceEdition: string;
  readonly archiveSha256: string;
  readonly records: readonly RegistryRecord[];
}

/** In force (or in transition): the share that is reported; the asset keeps every status. */
function isInForce(status: string): boolean {
  const text = status.toLocaleLowerCase('ru-RU');
  return (
    text.startsWith('действ') ||
    text.startsWith('выдано по правилам') ||
    text.includes('приостанов')
  );
}

/** Same order as the registry parser: a record in force beats an expired or changed one. */
function statusRank(status: string): number {
  const text = status.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (text.startsWith('действ') || text.startsWith('выдано по правилам')) return 5;
  if (text.includes('приостанов')) return 4;
  if (text.includes('исключ')) return 3;
  if (text.includes('истек')) return 2;
  if (text.includes('измен')) return 1;
  return 0;
}

function latestCatalog(directory: string): string {
  const [latest] = readdirSync(directory)
    .filter((name) => /^catalog-\d{2}\.\d{2}\.\d{4}\.json$/u.test(name))
    .sort((left, right) => {
      const key = (name: string): string => name.slice(8, 18).split('.').reverse().join('');
      return key(right).localeCompare(key(left));
    });
  if (!latest) throw new Error(`no catalog-DD.MM.YYYY.json under ${directory}`);
  return join(directory, latest);
}

const argument = process.argv[2];
const input = argument ?? latestCatalog('data/raw/official-grls-registry');
const target = 'apps/app/src/features/medications/mfg-countries.json';
if (!existsSync('apps/app/src/features/medications')) throw new Error('run from the repo root');

const catalog = JSON.parse(readFileSync(input, 'utf8')) as RegistryCatalog;
// A drug screen also lists expired and changed registrations (ЕСКЛП keeps them), so every status is
// resolved; coverage is reported for the registrations in force.
const records = catalog.records;
const inForce = records.filter((record) => isInForce(record.status));

const resolved = new Map<string, { countries: readonly string[]; basis: MfgBasis; rank: number }>();
const basisCounts: Record<MfgBasis, number> = {
  'finished-form': 0,
  'release-qc': 0,
  'primary-packaging': 0,
  holder: 0,
};
const countryCounts = new Map<string, number>();
let unresolved = 0;
let multiSite = 0;
for (const record of records) {
  const result = resolveManufacturingCountries(record);
  if (!result) {
    unresolved += 1;
    continue;
  }
  const key = normalizeRegistrationKey(record.registrationNumber);
  const rank = statusRank(record.status);
  const previous = resolved.get(key);
  if (previous) {
    // «ЛП-N (000014)-(РГ-RU)» (changed) and «ЛП-№(000014)-(РГ-RU)» (in force) are one registration:
    // the record in force speaks for it.
    if (previous.rank === rank && previous.countries.join() !== result.countries.join()) {
      throw new Error(`${record.registrationNumber}: two countries under one key ${key}`);
    }
    if (previous.rank >= rank) continue;
  }
  resolved.set(key, { ...result, rank });
}
for (const { countries: names, basis } of resolved.values()) {
  basisCounts[basis] += 1;
  if (names.length > 1) multiSite += 1;
  for (const country of names) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
}

// Most common first: the small indices are the short JSON numbers.
const countries = [...countryCounts.entries()]
  .toSorted(
    ([leftName, left], [rightName, right]) =>
      right - left || leftName.localeCompare(rightName, 'ru'),
  )
  .map(([name]) => name);
const indexOf = new Map(countries.map((name, index) => [name, index] as const));

const registrations: Record<string, Record<string, number | number[]>> = {};
for (const basis of MFG_BASES) registrations[basis] = {};
for (const [key, { countries: names, basis }] of [...resolved.entries()].toSorted(
  ([left], [right]) => left.localeCompare(right, 'en'),
)) {
  const indices = names.map((name) => indexOf.get(name) as number);
  (registrations[basis] as Record<string, number | number[]>)[key] =
    indices.length === 1 ? (indices[0] as number) : indices;
}

const asset = {
  source: 'ГРЛС, государственный реестр лекарственных средств Минздрава России',
  sourceEdition: catalog.sourceEdition,
  sourceSha256: catalog.archiveSha256,
  basis:
    'страна производства готовой лекарственной формы; иначе площадка выпускающего контроля; иначе площадка первичной упаковки; иначе страна держателя РУ',
  countries,
  registrations,
};
const encoded = JSON.stringify(asset);
writeFileSync(target, `${encoded}\n`);

const share = (count: number): string => `${((100 * count) / records.length).toFixed(1)}%`;
const inForceKeys = inForce.map((record) => normalizeRegistrationKey(record.registrationNumber));
const inForceKnown = inForceKeys.filter((key) => resolved.has(key)).length;
console.log(
  `${target}: ${String(resolved.size)} of ${String(records.length)} registrations (${share(resolved.size)}), ${String(countries.length)} countries, ${String(encoded.length)} chars`,
);
console.log(
  `in force: ${String(inForceKnown)} of ${String(inForce.length)} have a country (${((100 * inForceKnown) / inForce.length).toFixed(2)}%)`,
);
console.log(
  `unresolved (no stage text, no holder country): ${String(unresolved)}; multi-site: ${String(multiSite)}`,
);
for (const basis of MFG_BASES) {
  console.log(`  ${basis}: ${String(basisCounts[basis])} (${share(basisCounts[basis])})`);
}
console.log(
  `  top countries: ${countries
    .slice(0, 12)
    .map((name) => `${name} ${String(countryCounts.get(name))}`)
    .join(', ')}`,
);
