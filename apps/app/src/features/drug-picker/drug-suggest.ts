/**
 * Medicine-name suggestions for the treatment editor: the doctor types a name, gets the matching
 * substance cards (ЕСКЛП МНН), picks one, and the pick feeds the patient's recipe (name, form,
 * strength, signa).
 *
 * Matching is the shared name rule (`drug-name-match.ts`): each typed word begins a word of the
 * МНН or of one trade name of the card, in any order, with inflection endings tolerated.
 *
 * Ordering. The product asks for «sorted by relevance (how often prescribed)», but the shipped data
 * holds no prescribing frequency. The order is therefore
 *   1. the match score of the name rule (a fully typed name before a component of a combination),
 *   2. a popularity PROXY for equal scores: whether the drug is in the ЖНВЛП list (an essential
 *      drug is prescribed far more often than the average registered one) and the size of its
 *      market, the number of registrations and of manufacturers, log-scaled so that one huge
 *      generic family does not drown the rest,
 *   3. the name, so the order is stable.
 * When real prescribing counts arrive, replace `drugPopularity` and keep the rest.
 */
import type { AssetCard, ComparisonIndex } from '@/features/drug-comparison/comparison-index';
import { ESSENTIAL_LISTED } from '@/features/drug-comparison/comparison-index';
import { loadComparisonIndex } from '@/features/drug-comparison/comparison-load';
import { type DrugNameEntry, drugNameEntries, matchDrugNames } from './drug-name-match';

export interface DrugSuggestionForm {
  /** Dosage form wording, lower case («таблетки, покрытые оболочкой»). */
  readonly form: string;
  /** Distinct strengths of the form as the registry writes them («50 мг»). */
  readonly strengths: readonly string[];
}

export interface DrugSuggestion {
  /** ЕСКЛП МНН card slug (`esklp.mnn.<slug>`). */
  readonly slug: string;
  /** The МНН in sentence case: first letter upper, the rest lower. */
  readonly name: string;
  /** The trade name the typed words matched, when they matched a trade name and not the МНН. */
  readonly product: string | null;
  /** Some form of the card is in the ЖНВЛП list. */
  readonly essential: boolean;
  /** Distinct dosage forms of the card with their strengths, most likely first. */
  readonly forms: readonly DrugSuggestionForm[];
  /** The name rule's match score (higher is better). */
  readonly score: number;
}

export const DEFAULT_SUGGESTION_LIMIT = 8;

/** Registrations / manufacturers at which the market-size part of the proxy saturates. */
const REGISTRATIONS_SATURATION = 1000;
const MANUFACTURERS_SATURATION = 100;
const ESSENTIAL_WEIGHT = 0.4;
const REGISTRATIONS_WEIGHT = 0.35;
const MANUFACTURERS_WEIGHT = 0.25;

/** Sentence case: first letter upper, the rest lower («САЛЬБУТАМОЛ» → «Сальбутамол»). */
export function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('ru-RU');
  return lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
}

function logScale(count: number, saturation: number): number {
  return Math.min(1, Math.log1p(count) / Math.log1p(saturation));
}

function isEssential(card: AssetCard): boolean {
  return card.f.some(([, , essential]) => (essential & ESSENTIAL_LISTED) !== 0);
}

/**
 * The popularity proxy in [0, 1]: ЖНВЛП membership plus the log-scaled number of registrations and
 * of manufacturers. Not a prescribing frequency (there is none in the data); see the file header.
 */
export function drugPopularity(card: AssetCard): number {
  return (
    (isEssential(card) ? ESSENTIAL_WEIGHT : 0) +
    REGISTRATIONS_WEIGHT * logScale(card.r, REGISTRATIONS_SATURATION) +
    MANUFACTURERS_WEIGHT * logScale(card.m, MANUFACTURERS_SATURATION)
  );
}

/**
 * The card's distinct forms with their distinct strengths. A form of the ЖНВЛП list comes first,
 * then the form with more strengths (a wider range is the usual sign of a common form), then the
 * registry order.
 */
export function suggestionForms(
  card: AssetCard,
  formNames: readonly string[],
): readonly DrugSuggestionForm[] {
  const byForm = new Map<number, { strengths: Set<string>; listed: boolean; order: number }>();
  card.f.forEach(([form, strengths, essential], order) => {
    const entry = byForm.get(form) ?? { strengths: new Set<string>(), listed: false, order };
    for (const strength of strengths) {
      const trimmed = strength.trim();
      if (trimmed !== '') entry.strengths.add(trimmed);
    }
    entry.listed ||= (essential & ESSENTIAL_LISTED) !== 0;
    byForm.set(form, entry);
  });
  return [...byForm.entries()]
    .flatMap(([form, entry]) => {
      const name = formNames[form];
      return name === undefined
        ? []
        : [
            {
              form: name,
              strengths: [...entry.strengths],
              listed: entry.listed,
              order: entry.order,
            },
          ];
    })
    .toSorted(
      (left, right) =>
        Number(right.listed) - Number(left.listed) ||
        right.strengths.length - left.strengths.length ||
        left.order - right.order,
    )
    .map(({ form, strengths }) => ({ form, strengths }));
}

/**
 * The pure ranking: the cards the typed text names, best first (score, then popularity, then
 * name), cut to `limit`.
 */
export function rankDrugSuggestions(
  index: ComparisonIndex,
  entries: readonly DrugNameEntry[],
  query: string,
  limit = DEFAULT_SUGGESTION_LIMIT,
): readonly DrugSuggestion[] {
  const ranked = matchDrugNames(entries, query, entries.length).flatMap((match) => {
    const position = index.cardBySlug.get(match.slug);
    const card = position === undefined ? undefined : index.asset.cards[position];
    return card ? [{ match, card, popularity: drugPopularity(card) }] : [];
  });
  return ranked
    .toSorted(
      (left, right) =>
        right.match.score - left.match.score ||
        right.popularity - left.popularity ||
        left.match.name.localeCompare(right.match.name, 'ru'),
    )
    .slice(0, limit)
    .map(
      ({ match, card }): DrugSuggestion => ({
        slug: match.slug,
        name: sentenceCase(match.name),
        product: match.product,
        essential: isEssential(card),
        forms: suggestionForms(card, index.asset.forms),
        score: match.score,
      }),
    );
}

interface Loaded {
  readonly index: ComparisonIndex;
  readonly entries: readonly DrugNameEntry[];
}

let loaded: Promise<Loaded> | undefined;

function load(): Promise<Loaded> {
  loaded ??= loadComparisonIndex()
    .then((index) => ({ index, entries: drugNameEntries(index.asset) }))
    .catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
  return loaded;
}

/** Suggestions for a typed medicine name; empty (with a console warning) if the names are unavailable. */
export async function suggestDrugs(
  query: string,
  limit = DEFAULT_SUGGESTION_LIMIT,
): Promise<readonly DrugSuggestion[]> {
  let names: Loaded;
  try {
    names = await load();
  } catch (cause) {
    console.warn('The drug names for suggestions are unavailable.', cause);
    return [];
  }
  return rankDrugSuggestions(names.index, names.entries, query, limit);
}
