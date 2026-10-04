/**
 * Build-time half of the manufacturing-country asset: reads the «Сведения о стадиях производства»
 * text of a ГРЛС registry record and decides in which country the product is made. Used by
 * `scripts/build-mfg-countries.ts` only; nothing here ships in the app bundle.
 *
 * The registry export carries one stage line per registration:
 * `Производитель (готовой ЛФ),<name>, <address>, <country>`. A cell that lists several stages is
 * split into its lines. The country of the stage that makes the finished dosage form wins over the
 * release-control site, then over a primary-packaging site; secondary packers, solvent and
 * substance makers do not make the product, so a record with only those (or with no stage text)
 * falls back to the holder's country. The chosen rule is kept as `basis`.
 */

import type { MfgBasis } from './mfg-country';

export type MfgStageKind = 'finished-form' | 'release-qc' | 'primary-packaging' | 'other';

export interface MfgStage {
  readonly label: string;
  readonly kind: MfgStageKind;
  /** Country as the registry wrote it. */
  readonly rawCountry: string;
}

export interface MfgResolution {
  /** Short Russian names, in order of first appearance. */
  readonly countries: readonly string[];
  readonly basis: MfgBasis;
}

const STAGE_LABEL =
  '(?:Производитель \\([^)]*\\)|Производитель растворителя|Производитель фармацевтической субстанции|Упаковщик/фасовщик(?: растворителя)?(?: \\([^)]*\\))?|Выпускающий контроль качества|Производство готовой лекарственной формы|Все стадии(?: производства)?|Первичная упаковка)';

const STAGE_START = new RegExp(`(?:^|(?<=\\s))(?=${STAGE_LABEL}\\s*,)`, 'gu');
const STAGE_LINE = new RegExp(`^(${STAGE_LABEL})\\s*,\\s*(.*)$`, 'su');

function stageKind(label: string): MfgStageKind {
  const text = label.toLocaleLowerCase('ru-RU');
  if (text.includes('растворител') || text.includes('субстанци')) return 'other';
  if (text.includes('все стадии') || text.includes('готовой л')) return 'finished-form';
  if (text.includes('выпускающий контроль')) return 'release-qc';
  if (text.includes('первичн') && text.includes('упаков')) return 'primary-packaging';
  return 'other';
}

/** The stage lines of one `manufacturer` cell; a cell that is not stage text yields none. */
export function parseManufacturerStages(cell: string | null | undefined): readonly MfgStage[] {
  const text = (cell ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) return [];
  const stages: MfgStage[] = [];
  for (const part of text.split(STAGE_START)) {
    const match = STAGE_LINE.exec(part.trim());
    if (!match) continue;
    const label = match[1] ?? '';
    const rest = match[2] ?? '';
    const rawCountry = rest.slice(rest.lastIndexOf(',') + 1).trim();
    if (!rawCountry || rest.lastIndexOf(',') < 0) continue;
    stages.push({ label, kind: stageKind(label), rawCountry });
  }
  return stages;
}

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  'республика беларусь': 'Беларусь',
  'республика хорватия': 'Хорватия',
  'чешская республика': 'Чехия',
  'соединенное королевство': 'Великобритания',
  'соединенное королевство великобритании и северной ирландии': 'Великобритания',
  'объединенное королевство': 'Великобритания',
  'республика казахстан': 'Казахстан',
  'республика северная македония': 'Северная Македония',
  'республика македония': 'Северная Македония',
  'словацкая республика': 'Словакия',
  корея: 'Южная Корея',
  'корея южная': 'Южная Корея',
  'республика корея': 'Южная Корея',
  кнр: 'Китай',
  'китайская республика': 'Тайвань',
  'республика молдова': 'Молдова',
  'республика армения': 'Армения',
  'республика сербия': 'Сербия',
  'эстонская республика': 'Эстония',
  'республика эстония': 'Эстония',
  'киргизская республика': 'Киргизия',
  'кыргызская республика': 'Киргизия',
  'республика узбекистан': 'Узбекистан',
  'республика польша': 'Польша',
  'российская федерация': 'Россия',
  сша: 'США',
  оаэ: 'ОАЭ',
  юар: 'ЮАР',
};

const KEEP_UPPERCASE = new Set(['США', 'ОАЭ', 'ЮАР']);

/** A registry country spelling as the short name a physician reads: «Республика Беларусь» → «Беларусь». */
export function normalizeCountryName(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text || text === '~') return null;
  const key = text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const aliased = COUNTRY_ALIASES[key];
  if (aliased) return aliased;
  const bare = text.replace(/^республика\s+/iu, '');
  if (KEEP_UPPERCASE.has(bare)) return bare;
  return bare.charAt(0).toLocaleUpperCase('ru-RU') + bare.slice(1);
}

function uniqueCountries(rawCountries: readonly string[]): readonly string[] {
  const countries: string[] = [];
  for (const raw of rawCountries) {
    const country = normalizeCountryName(raw);
    if (country && !countries.includes(country)) countries.push(country);
  }
  return countries;
}

const STAGE_PRIORITY: readonly Exclude<MfgStageKind, 'other'>[] = [
  'finished-form',
  'release-qc',
  'primary-packaging',
];

/** The manufacturing country of one registry record, or null when neither stages nor holder name one. */
export function resolveManufacturingCountries(record: {
  readonly manufacturer?: string | null;
  readonly holderCountry?: string | null;
}): MfgResolution | null {
  const stages = parseManufacturerStages(record.manufacturer);
  for (const kind of STAGE_PRIORITY) {
    const countries = uniqueCountries(
      stages.filter((stage) => stage.kind === kind).map((stage) => stage.rawCountry),
    );
    if (countries.length > 0) return { countries, basis: kind };
  }
  const holder = normalizeCountryName(record.holderCountry);
  return holder ? { countries: [holder], basis: 'holder' } : null;
}
