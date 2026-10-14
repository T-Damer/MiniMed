/**
 * What the drug pickers add to the main search (SRCH1): the cards the shared name rule finds
 * (`drug-name-match.ts`) among the shipped drug names, as result groups of the substance card
 * (`esklp.mnn.<slug>`, titled like the search titles a trade-name hit: «Аспирин · АЦЕТИЛСАЛИЦИЛОВАЯ
 * КИСЛОТА»). Every picker already maps such a group to its own candidate, so the rule is added in
 * one place instead of four.
 */
import type { SearchResultGroup } from '@localmed/contracts';

import { loadComparisonIndex } from '@/features/drug-comparison/comparison-load';
import { cardSlugOfDocumentId } from './card-id';
import { type DrugNameEntry, drugNameEntries, matchDrugNames } from './drug-name-match';

const CARD_PREFIX = 'esklp.mnn.';
const DEFAULT_DIRECTORY_GROUPS = 8;

let entries: Promise<readonly DrugNameEntry[]> | undefined;

function loadEntries(): Promise<readonly DrugNameEntry[]> {
  entries ??= loadComparisonIndex()
    .then((index) => drugNameEntries(index.asset))
    .catch((error: unknown) => {
      entries = undefined;
      throw error;
    });
  return entries;
}

/** The cards a typed name stands for by the shared rule, as groups; none if the names are unavailable. */
export async function drugDirectoryGroups(
  text: string,
  limit = DEFAULT_DIRECTORY_GROUPS,
): Promise<readonly SearchResultGroup[]> {
  let loaded: readonly DrugNameEntry[];
  try {
    loaded = await loadEntries();
  } catch (cause) {
    console.warn('The drug names of the pickers are unavailable.', cause);
    return [];
  }
  return matchDrugNames(loaded, text, limit).map(
    (match, position): SearchResultGroup => ({
      documentId: `${CARD_PREFIX}${match.slug}`,
      title: match.product ? `${match.product} · ${match.name}` : match.name,
      // Below any text hit, in the order of the match.
      bestScore: 0.01 + (limit - position) / (limit * 100),
      categories: [],
      results: [],
    }),
  );
}

/** The directory cards whose substance the search did not return. */
export function directoryExtras(
  searched: readonly SearchResultGroup[],
  directory: readonly SearchResultGroup[],
): readonly SearchResultGroup[] {
  const seen = new Set(
    searched.flatMap((group) => {
      const slug = cardSlugOfDocumentId(group.documentId);
      return slug === null ? [] : [slug];
    }),
  );
  return directory.filter((group) => {
    const slug = cardSlugOfDocumentId(group.documentId);
    return slug !== null && !seen.has(slug);
  });
}

/** The search groups, then the directory's cards that the search did not return (a suggestion list). */
export function withDirectoryGroups(
  searched: readonly SearchResultGroup[],
  directory: readonly SearchResultGroup[],
): readonly SearchResultGroup[] {
  const extra = directoryExtras(searched, directory);
  return extra.length === 0 ? searched : [...searched, ...extra];
}

/**
 * The groups a resolver checks: the first `checked` search groups, then the directory's cards the
 * search did not return, so a card the search missed is still looked at.
 */
export function checkedWithDirectory(
  searched: readonly SearchResultGroup[],
  directory: readonly SearchResultGroup[],
  checked: number,
): readonly SearchResultGroup[] {
  return [...searched.slice(0, checked), ...directoryExtras(searched, directory)];
}
