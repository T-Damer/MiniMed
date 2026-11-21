import {
  createTimeSlicer,
  lightStemRussian,
  normalizeSurfaceText,
  normalizeTransientSurfaceText,
  parseAtcQueries,
  tokenizeNormalizedSurfaceText,
} from '@localmed/search-lexical';

import type { MedicationProduct } from '@/features/medications/medication-record';

export function medicationSearchText(product: MedicationProduct): string {
  return [
    product.tradeName,
    product.inn,
    product.shortDescription ?? '',
    product.supplementalDescription ?? '',
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
  return tokenizeNormalizedSurfaceText(value).map((token) => lightStemRussian(token));
}

const FORM_SYNONYM_STEMS = new Set([
  lightStemRussian('сироп'),
  lightStemRussian('спироп'),
  lightStemRussian('суспензия'),
]);

function stemAlternatives(stem: string): readonly string[] {
  return FORM_SYNONYM_STEMS.has(stem) ? [...FORM_SYNONYM_STEMS] : [stem];
}

function fieldContainsStem(fieldStems: ReadonlySet<string>, queryStem: string): boolean {
  return stemAlternatives(queryStem).some(
    (alternative) =>
      fieldStems.has(alternative) ||
      [...fieldStems].some(
        (fieldStem) => fieldStem.startsWith(alternative) || alternative.startsWith(fieldStem),
      ),
  );
}

function queryStemsMatch(fieldStems: ReadonlySet<string>, queryStems: readonly string[]): boolean {
  return queryStems.every((queryStem) => fieldContainsStem(fieldStems, queryStem));
}

function isCombinationName(value: string): boolean {
  return /[+/]|(\sи\s)|(\sс\s)/u.test(value);
}

/** Score of a product whose ATC code (registry or consensus) starts with the code searched for. */
const ATC_CODE_SCORE = 60;

/**
 * The ways the typed query reads as an ATC code or prefix (`J05`, `j05 ax`, `J05AX13`, Cyrillic
 * look-alikes and the Russian layout too; the shared reading of `parseAtcQueries`, ATC5). A letter
 * with one digit, a lone letter and any word are not codes.
 */
function atcCodeQueries(query: string): readonly string[] {
  return parseAtcQueries(query).map((atc) => atc.code);
}

function medicationCatalogEntryScore(
  product: MedicationProduct,
  normalizedQuery: string,
  queryStems: readonly string[],
  atcQueries: readonly string[],
): number {
  const byAtc = product.atcCodes?.some((code) => atcQueries.some((atc) => code.startsWith(atc)))
    ? ATC_CODE_SCORE
    : 0;
  return Math.max(byAtc, medicationNameScore(product, normalizedQuery, queryStems));
}

function medicationNameScore(
  product: MedicationProduct,
  normalizedQuery: string,
  queryStems: readonly string[],
): number {
  const trade = normalizeTransientSurfaceText(product.tradeName);
  const inn = normalizeTransientSurfaceText(product.inn);
  const tradeCombination = isCombinationName(trade);

  if (trade === normalizedQuery) return 100;
  if (trade.startsWith(normalizedQuery) && !tradeCombination) return 92;
  if (trade.startsWith(normalizedQuery)) return 82;
  if (inn === normalizedQuery) return 48;
  const innStems = new Set(stems(inn));
  if (
    inn.startsWith(normalizedQuery) &&
    !isCombinationName(inn) &&
    innStems.size === queryStems.length
  ) {
    return 46;
  }
  if (inn.startsWith(normalizedQuery)) return 38;

  const tradeStems = new Set(stems(trade));
  const tradeMatch = queryStemsMatch(tradeStems, queryStems);
  if (tradeMatch && !tradeCombination) {
    return 70;
  }
  const innMatch = queryStemsMatch(innStems, queryStems);
  if (innMatch && innStems.size === queryStems.length) {
    return 44;
  }
  if (tradeMatch || innMatch) {
    return 36;
  }

  const missingTradeStems = queryStems.filter((stem) => !fieldContainsStem(tradeStems, stem));
  const presentationMatch = product.presentations.some((presentation) =>
    queryStemsMatch(
      new Set(
        stems(
          normalizeTransientSurfaceText(
            [
              presentation.dosageForm,
              presentation.strength ?? '',
              presentation.route ?? '',
              ...presentation.packages.map((item) => item.description),
            ].join(' '),
          ),
        ),
      ),
      missingTradeStems,
    ),
  );
  if (presentationMatch && !tradeCombination) return 88;
  if (presentationMatch) return 76;

  const haystack = normalizeTransientSurfaceText(medicationSearchText(product));
  if (haystack.includes(normalizedQuery)) return 18;
  if (
    queryStems.every((stem) =>
      stemAlternatives(stem).some((alternative) => haystack.includes(alternative)),
    )
  ) {
    return 12;
  }
  return 0;
}

export function medicationCatalogMatchScore(product: MedicationProduct, query: string): number {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return 1;
  const queryStems = stems(normalizedQuery);
  if (queryStems.length === 0) return 0;
  return medicationCatalogEntryScore(product, normalizedQuery, queryStems, atcCodeQueries(query));
}

const nameCollator = new Intl.Collator('ru');

function* medicationCatalogRanking(
  products: readonly MedicationProduct[],
  query: string,
): Generator<void, readonly MedicationProduct[]> {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return products;
  const queryStems = stems(normalizedQuery);
  if (queryStems.length === 0) return [];
  const atcQueries = atcCodeQueries(query);

  const matches: { product: MedicationProduct; score: number }[] = [];
  for (const product of products) {
    const score = medicationCatalogEntryScore(product, normalizedQuery, queryStems, atcQueries);
    if (score > 0) matches.push({ product, score });
    yield;
  }
  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        nameCollator.compare(left.product.tradeName, right.product.tradeName),
    )
    .map((entry) => entry.product);
}

export function rankMedicationCatalog(
  products: readonly MedicationProduct[],
  query: string,
): readonly MedicationProduct[] {
  const ranking = medicationCatalogRanking(products, query);
  let step = ranking.next();
  while (!step.done) step = ranking.next();
  return step.value;
}

export async function rankMedicationCatalogSliced(
  products: readonly MedicationProduct[],
  query: string,
  signal: AbortSignal,
): Promise<readonly MedicationProduct[]> {
  if (signal.aborted) return [];
  const ranking = medicationCatalogRanking(products, query);
  const slice = createTimeSlicer();
  let step = ranking.next();
  while (!step.done) {
    const due = slice();
    if (due) await due;
    if (signal.aborted) return [];
    step = ranking.next();
  }
  return step.value;
}
