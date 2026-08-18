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

function fieldStartsWithQuery(field: string, query: string): boolean {
  const normalizedField = normalizeSurfaceText(field);
  const normalizedQuery = normalizeSurfaceText(query);
  if (!normalizedQuery || !normalizedField.startsWith(normalizedQuery)) return false;
  return (
    normalizedField.length === normalizedQuery.length ||
    /[\s,;:+(]/.test(normalizedField.slice(normalizedQuery.length, normalizedQuery.length + 1))
  );
}

function queryStemsMatch(field: string, queryStems: readonly string[]): boolean {
  const fieldStems = new Set(stems(field));
  return queryStems.every(
    (queryStem) =>
      fieldStems.has(queryStem) ||
      [...fieldStems].some(
        (fieldStem) => fieldStem.startsWith(queryStem) || queryStem.startsWith(fieldStem),
      ),
  );
}

function isCombinationName(value: string): boolean {
  return /[+/]|(\sи\s)|(\sс\s)/u.test(normalizeSurfaceText(value));
}

export function medicationCatalogMatchScore(product: MedicationProduct, query: string): number {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return 1;

  const queryStems = stems(normalizedQuery);
  if (queryStems.length === 0) return 0;

  const trade = normalizeSurfaceText(product.tradeName);
  const inn = normalizeSurfaceText(product.inn);
  if (trade === normalizedQuery) return 100;

  const tradeHead = fieldStartsWithQuery(product.tradeName, normalizedQuery);
  const innHead = fieldStartsWithQuery(product.inn, normalizedQuery);
  if (tradeHead && !isCombinationName(product.tradeName)) return 88;
  if (tradeHead) return 62;
  if (inn === normalizedQuery) return 48;
  if (
    innHead &&
    !isCombinationName(product.inn) &&
    stems(product.inn).length === queryStems.length
  ) {
    return 46;
  }
  if (innHead) return 38;

  if (queryStemsMatch(product.tradeName, queryStems) && !isCombinationName(product.tradeName)) {
    return 70;
  }
  if (queryStemsMatch(product.inn, queryStems) && stems(product.inn).length === queryStems.length) {
    return 44;
  }
  if (queryStemsMatch(product.tradeName, queryStems) || queryStemsMatch(product.inn, queryStems)) {
    return 36;
  }

  const haystack = normalizeSurfaceText(medicationSearchText(product));
  if (haystack.includes(normalizedQuery)) return 18;
  if (queryStems.every((stem) => haystack.includes(stem))) return 12;
  return 0;
}

export function rankMedicationCatalog(
  products: readonly MedicationProduct[],
  query: string,
): readonly MedicationProduct[] {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return products;

  return products
    .map((product, index) => ({
      product,
      index,
      score: medicationCatalogMatchScore(product, query),
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
