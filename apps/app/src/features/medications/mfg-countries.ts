import {
  MFG_BASES,
  type MfgBasis,
  type MfgCountryCatalog,
  type MfgCountryEntry,
} from '@/features/medications/mfg-country';

/**
 * Loader of the manufacturing-country asset (a few hundred kB). The JSON is its own chunk: it is
 * fetched the first time a medication screen asks for it and never belongs to the start-up bundle.
 * Built by `scripts/build-mfg-countries.ts` from the ГРЛС registry in
 * `data/raw/official-grls-registry/`.
 *
 * Asset shape: `countries` is the list of names; `registrations[basis]` maps a normalised
 * registration number to a country index, or to a list of indices for a multi-site product.
 */

let pending: Promise<MfgCountryCatalog> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the asset's shape once; a malformed chunk is an error, not an empty catalog. */
export function parseMfgCountryCatalog(value: unknown): MfgCountryCatalog {
  if (!isRecord(value)) throw new Error('Manufacturing countries: not an object');
  const { source, sourceEdition, countries, registrations } = value;
  if (typeof source !== 'string' || typeof sourceEdition !== 'string') {
    throw new Error('Manufacturing countries: source or edition is missing');
  }
  if (!Array.isArray(countries) || !countries.every((name) => typeof name === 'string')) {
    throw new Error('Manufacturing countries: countries are not a list of names');
  }
  if (!isRecord(registrations)) throw new Error('Manufacturing countries: registrations missing');
  const names = countries as readonly string[];
  const entries = new Map<string, MfgCountryEntry>();
  for (const basis of MFG_BASES) {
    const group = registrations[basis];
    if (group === undefined) continue;
    if (!isRecord(group)) throw new Error(`Manufacturing countries: ${basis} is not a map`);
    for (const [key, indices] of Object.entries(group)) {
      const list: readonly unknown[] = Array.isArray(indices) ? indices : [indices];
      const resolved = list.map((index) => (typeof index === 'number' ? names[index] : undefined));
      if (resolved.length === 0 || resolved.some((name) => name === undefined)) {
        throw new Error(`Manufacturing countries: ${key} points at an unknown country`);
      }
      entries.set(key, { countries: resolved as readonly string[], basis: basis as MfgBasis });
    }
  }
  return { source, sourceEdition, entries };
}

export function loadMfgCountries(): Promise<MfgCountryCatalog> {
  pending ??= import('@/features/medications/mfg-countries.json')
    .then((module) => parseMfgCountryCatalog(module.default))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
