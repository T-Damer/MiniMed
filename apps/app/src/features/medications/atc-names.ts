import type { AtcNameCatalog } from '@/features/medications/atc-code';

/**
 * Loader of the NSI «АТХ» names (levels 1-4, ~110 kB). The JSON is its own chunk: it is fetched
 * the first time an ATC sheet opens and never belongs to the start-up bundle. Built by
 * `scripts/build-atc-names.ts` from `data/raw/nsi/atc/` (see `docs/NSI_FETCH.md`).
 */

let pending: Promise<AtcNameCatalog> | undefined;

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/** Checks the asset's shape once; a malformed chunk is an error, not an empty catalog. */
export function parseAtcNameCatalog(value: unknown): AtcNameCatalog {
  if (typeof value !== 'object' || value === null) throw new Error('ATC names: not an object');
  const { source, version, publishDate, names } = value as Record<string, unknown>;
  if (
    typeof source !== 'string' ||
    typeof version !== 'string' ||
    typeof publishDate !== 'string'
  ) {
    throw new Error('ATC names: source, version or date is missing');
  }
  if (!isRecordOfStrings(names)) throw new Error('ATC names: names are not a code → text map');
  return { source, version, publishDate, names };
}

export function loadAtcNames(): Promise<AtcNameCatalog> {
  pending ??= import('@/features/medications/atc-names.json')
    .then((module) => parseAtcNameCatalog(module.default))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
