/**
 * Country of manufacture of a registered drug, shown after the trade name: «Дроперидол (Россия)».
 *
 * The data is the lazy asset `mfg-countries.json` (see `mfg-countries.ts`), keyed by registration
 * number; this module holds the pure parts: the number key, the lookup and the formatting. The
 * country is where the product is made according to the ГРЛС production stages, with the holder's
 * country as a recorded fallback; the `basis` tells which of the two a value rests on.
 */

/** Which registry fact the country rests on, best first. */
export type MfgBasis = 'finished-form' | 'release-qc' | 'primary-packaging' | 'holder';

export const MFG_BASES: readonly MfgBasis[] = [
  'finished-form',
  'release-qc',
  'primary-packaging',
  'holder',
];

export interface MfgCountryEntry {
  /** Short Russian names; usually one. */
  readonly countries: readonly string[];
  readonly basis: MfgBasis;
}

export interface MfgCountryCatalog {
  readonly source: string;
  readonly sourceEdition: string;
  readonly entries: ReadonlyMap<string, MfgCountryEntry>;
}

const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
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
  Y: 'У',
};

/**
 * Identity of a registration number: «ЛП-№(007733)-(РГ-RU)», «ЛП-N (007733)-(РГ-RU)» and the same
 * with a Latin «Р» or a no-break space are one number; «П N014471/01» and «П №014471/01» too. Only
 * spelling is normalised, digits and their order are never touched.
 */
export function normalizeRegistrationKey(value: string): string {
  return value
    .toLocaleUpperCase('ru-RU')
    .replace(/[‐-―−]/gu, '-')
    .replace(/\s+/gu, '')
    .replace(/[A-Z]/gu, (letter) => LATIN_TO_CYRILLIC[letter] ?? letter)
    .replaceAll('N', '№');
}

/** The countries a registration is made in, or none when the registry does not say. */
export function manufacturingCountries(
  catalog: MfgCountryCatalog | undefined,
  registrationNumber: string,
): readonly string[] {
  return catalog?.entries.get(normalizeRegistrationKey(registrationNumber))?.countries ?? [];
}

export function manufacturingBasis(
  catalog: MfgCountryCatalog | undefined,
  registrationNumber: string,
): MfgBasis | null {
  return catalog?.entries.get(normalizeRegistrationKey(registrationNumber))?.basis ?? null;
}

/** «Дроперидол» + «Россия» → «Дроперидол (Россия)»; without a country the name stays as it is. */
export function formatTradeNameWithCountry(
  name: string,
  country: string | null | undefined,
): string {
  const text = country?.trim();
  return text ? `${name} (${text})` : name;
}

/** The text of the country mark of one registration: «Индия, Россия» for a multi-site product. */
export function countryMarkText(countries: readonly string[]): string | null {
  return countries.length > 0 ? countries.join(', ') : null;
}

const BASIS_TITLE: Readonly<Record<MfgBasis, string>> = {
  'finished-form': 'Страна производства готовой лекарственной формы по данным ГРЛС',
  'release-qc': 'Страна площадки выпускающего контроля качества по данным ГРЛС',
  'primary-packaging': 'Страна площадки, фасующей в первичную упаковку, по данным ГРЛС',
  holder: 'Страна держателя регистрационного удостоверения: ГРЛС не называет площадку производства',
};

/** Tooltip text that tells which registry fact the country rests on. */
export function manufacturingBasisTitle(basis: MfgBasis | null): string | undefined {
  return basis ? BASIS_TITLE[basis] : undefined;
}
