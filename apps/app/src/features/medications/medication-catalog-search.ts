import { lightStemRussian, normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

import type { MedicationProduct } from '@/features/medications/medication-record';

export function medicationSearchText(product: MedicationProduct): string {
  return [
    product.tradeName,
    product.inn,
    product.registrationNumber,
    product.registrationStatus,
    product.prescriptionStatus ?? '',
    product.holder ?? '',
    product.manufacturer ?? '',
    ...product.pharmacotherapeuticGroups,
    ...product.presentations.flatMap((presentation) => [
      presentation.dosageForm,
      presentation.strength ?? '',
      presentation.route ?? '',
      ...presentation.packages.flatMap((item) => [item.description, item.prescriptionStatus ?? '']),
    ]),
  ].join(' ');
}

function stems(value: string): readonly string[] {
  return tokenize(normalizeSurfaceText(value)).map((token) => lightStemRussian(token));
}

function queryStemsMatch(fieldStems: ReadonlySet<string>, queryStems: readonly string[]): boolean {
  return queryStems.every(
    (queryStem) =>
      fieldStems.has(queryStem) ||
      [...fieldStems].some(
        (fieldStem) => fieldStem.startsWith(queryStem) || queryStem.startsWith(fieldStem),
      ),
  );
}

function isCombinationName(value: string): boolean {
  return /[+/]|(\sи\s)|(\sс\s)/u.test(value);
}

interface MedicationSearchEntry {
  readonly trade: string;
  readonly inn: string;
  readonly tradeStems: ReadonlySet<string>;
  readonly innStems: ReadonlySet<string>;
  readonly tradeCombination: boolean;
  readonly innCombination: boolean;
  readonly haystack: string;
}

const medicationSearchEntries = new WeakMap<MedicationProduct, MedicationSearchEntry>();

function medicationSearchEntry(product: MedicationProduct): MedicationSearchEntry {
  const cached = medicationSearchEntries.get(product);
  if (cached) return cached;
  const trade = normalizeSurfaceText(product.tradeName);
  const inn = normalizeSurfaceText(product.inn);
  const entry = {
    trade,
    inn,
    tradeStems: new Set(stems(trade)),
    innStems: new Set(stems(inn)),
    tradeCombination: isCombinationName(trade),
    innCombination: isCombinationName(inn),
    haystack: normalizeSurfaceText(medicationSearchText(product)),
  };
  medicationSearchEntries.set(product, entry);
  return entry;
}

function medicationCatalogEntryScore(
  product: MedicationProduct,
  normalizedQuery: string,
  queryStems: readonly string[],
): number {
  const entry = medicationSearchEntry(product);
  const { trade, inn } = entry;

  if (trade === normalizedQuery) return 100;
  if (trade.startsWith(normalizedQuery) && !entry.tradeCombination) return 92;
  if (trade.startsWith(normalizedQuery)) return 82;
  if (inn === normalizedQuery) return 48;
  if (
    inn.startsWith(normalizedQuery) &&
    !entry.innCombination &&
    entry.innStems.size === queryStems.length
  ) {
    return 46;
  }
  if (inn.startsWith(normalizedQuery)) return 38;

  if (queryStemsMatch(entry.tradeStems, queryStems) && !entry.tradeCombination) {
    return 70;
  }
  if (queryStemsMatch(entry.innStems, queryStems) && entry.innStems.size === queryStems.length) {
    return 44;
  }
  if (
    queryStemsMatch(entry.tradeStems, queryStems) ||
    queryStemsMatch(entry.innStems, queryStems)
  ) {
    return 36;
  }

  if (entry.haystack.includes(normalizedQuery)) return 18;
  if (queryStems.every((stem) => entry.haystack.includes(stem))) return 12;
  return 0;
}

export function medicationCatalogMatchScore(product: MedicationProduct, query: string): number {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return 1;
  const queryStems = stems(normalizedQuery);
  if (queryStems.length === 0) return 0;
  return medicationCatalogEntryScore(product, normalizedQuery, queryStems);
}

export function rankMedicationCatalog(
  products: readonly MedicationProduct[],
  query: string,
): readonly MedicationProduct[] {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return products;
  const queryStems = stems(normalizedQuery);
  if (queryStems.length === 0) return [];

  return products
    .map((product, index) => ({
      product,
      index,
      score: medicationCatalogEntryScore(product, normalizedQuery, queryStems),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.product.tradeName.localeCompare(right.product.tradeName, 'ru') ||
        left.index - right.index,
    )
    .map((entry) => entry.product);
}
