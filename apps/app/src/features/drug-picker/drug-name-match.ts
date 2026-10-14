/**
 * The one rule by which every drug picker (interactions, comparison, prescription and dose, safety)
 * reads a typed name against the names of the drug cards (SRCH1, QA 10-14: «сакубитрил» and
 * «сакубитрил/валсартан» found nothing, only «валсартан+сакубитрил» did).
 *
 * A name is a set of words; a combination is the words of its components («валсартан+сакубитрил»).
 * A typed text matches a card when each typed word begins a different word of one name of the card —
 * its standardized МНН or one of its trade names — wherever that word stands and in any order. The
 * separators «/», «+», «,», «-», spaces and brackets are all just word breaks. A typed word that is
 * longer than a name word by an inflection ending (up to three letters, «валсартана») counts too.
 *
 * The rule is pure and works on the cards of the shipped comparison index, so it answers offline,
 * before the instruction modules are installed and with no core at all; the pickers add its cards
 * to what the search found (`drug-search.ts`).
 */
import type { ComparisonIndexAsset } from '@/features/drug-comparison/comparison-index';

export interface DrugNameEntry {
  /** ЕСКЛП МНН card slug (`esklp.mnn.<slug>`). */
  readonly slug: string;
  /** The standardized МНН as the registry writes it. */
  readonly name: string;
  readonly words: readonly string[];
  /** Distinct trade names of the card's instruction documents. */
  readonly trade: readonly { readonly name: string; readonly words: readonly string[] }[];
}

export interface DrugNameMatch {
  readonly slug: string;
  readonly name: string;
  /** The trade name the typed words matched, when they matched a trade name and not the МНН. */
  readonly product: string | null;
  readonly score: number;
}

const WORD = /[\p{L}\p{N}]+/gu;
const MIN_LONGEST_TYPED_WORD = 3;
const MAX_INFLECTION_ENDING = 3;
const MIN_INFLECTED_NAME_WORD = 5;
const DEFAULT_LIMIT = 24;

/** Lower case, «ё» as «е», split at every character that is no letter or digit. */
export function drugNameWords(text: string): readonly string[] {
  return (text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(WORD) ?? []).filter(
    (word) => word.length >= 2 || /\p{N}/u.test(word),
  );
}

function stripRegistered(name: string): string {
  return name.replaceAll(/[®™]/gu, '').replaceAll(/\s+/gu, ' ').trim();
}

/** One entry per card; trade names are the instruction documents' titles, one per distinct name. */
export function drugNameEntries(asset: ComparisonIndexAsset): readonly DrugNameEntry[] {
  const trade = new Map<number, Map<string, string>>();
  for (const document of Object.values(asset.documents)) {
    if (!document.t) continue;
    const display = stripRegistered(document.t);
    const key = display.toLocaleLowerCase('ru-RU');
    if (key.length < 2) continue;
    for (const card of document.c) {
      let names = trade.get(card);
      if (!names) {
        names = new Map();
        trade.set(card, names);
      }
      if (!names.has(key)) names.set(key, display);
    }
  }
  return asset.cards.map((card, index) => ({
    slug: card.s,
    name: card.n,
    words: drugNameWords(card.n),
    trade: [...(trade.get(index)?.values() ?? [])].map((name) => ({
      name,
      words: drugNameWords(name),
    })),
  }));
}

function wordMatches(typed: string, nameWord: string): boolean {
  if (nameWord.startsWith(typed)) return true;
  return (
    nameWord.length >= MIN_INFLECTED_NAME_WORD &&
    typed.startsWith(nameWord) &&
    typed.length - nameWord.length <= MAX_INFLECTION_ENDING
  );
}

/**
 * How well the typed words cover one name, or 0 when some typed word begins no (still unused) word
 * of it: whole name 100, every word of the name typed (as prefixes) 80, a component of a combination
 * 40, fewer points the more words of the name stay untyped.
 */
function coverScore(typed: readonly string[], words: readonly string[]): number {
  if (typed.length === 0 || typed.length > words.length) return 0;
  const used = new Set<number>();
  let whole = 0;
  for (const word of typed) {
    let found = -1;
    // A whole-word hit is preferred, so «кислота» takes «кислота» and not the longer «кислотность».
    for (const exact of [true, false]) {
      found = words.findIndex(
        (candidate, index) =>
          !used.has(index) && (exact ? candidate === word : wordMatches(word, candidate)),
      );
      if (found >= 0) {
        if (exact) whole += 1;
        break;
      }
    }
    if (found < 0) return 0;
    used.add(found);
  }
  const untyped = words.length - typed.length;
  if (untyped === 0) return whole === typed.length ? 100 : 80;
  return Math.max(10, 40 - 4 * untyped) + (whole === typed.length ? 5 : 0);
}

/** The cards a typed text names, best first. */
export function matchDrugNames(
  entries: readonly DrugNameEntry[],
  query: string,
  limit = DEFAULT_LIMIT,
): readonly DrugNameMatch[] {
  const typed = drugNameWords(query);
  if (
    typed.length === 0 ||
    Math.max(...typed.map((word) => word.length)) < MIN_LONGEST_TYPED_WORD
  ) {
    return [];
  }
  const matches: DrugNameMatch[] = [];
  for (const entry of entries) {
    const byName = coverScore(typed, entry.words);
    let best: DrugNameMatch | null =
      byName > 0 ? { slug: entry.slug, name: entry.name, product: null, score: byName } : null;
    for (const product of entry.trade) {
      // A trade name ranks just under the same cover of the МНН: the substance card leads.
      const score = coverScore(typed, product.words) - 1;
      if (score > 0 && (!best || score > best.score)) {
        best = { slug: entry.slug, name: entry.name, product: product.name, score };
      }
    }
    if (best) matches.push(best);
  }
  return matches
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.name.length - right.name.length ||
        left.name.localeCompare(right.name, 'ru'),
    )
    .slice(0, limit);
}
