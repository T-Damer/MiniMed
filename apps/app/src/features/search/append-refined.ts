import type { SearchResponse } from '@localmed/contracts';

import { titleNamesWords } from '@/features/reader-dictionary/selection-term';

/**
 * A later, fuller answer to the search on screen (the full search after a quick first answer, the
 * search by meaning after the text one) never reshuffles what the reader is looking at (owner
 * 2026-11-16): the groups shown keep their place and their content, and the groups only the later
 * answer found are added under them, in the later answer's order.
 */
export interface AppendedResponse {
  readonly response: SearchResponse;
  /** Documents the later answer added: shown as their own part under the first results. */
  readonly appended: ReadonlySet<string>;
}

export function appendRefinedResponse(
  shown: SearchResponse,
  refined: SearchResponse,
  alreadyAppended: ReadonlySet<string> = new Set(),
): AppendedResponse {
  // Nothing was on screen: the later answer is simply the answer.
  if (shown.groups.length === 0) return { response: refined, appended: new Set() };
  const present = new Set(shown.groups.map((group) => group.documentId));
  const added = refined.groups.filter((group) => !present.has(group.documentId));
  return {
    response: {
      // What only the full answer knows (exact names, a corrected query, a drug class) comes with
      // it; the list keeps its order.
      ...refined,
      groups: [...shown.groups, ...added],
    },
    appended: new Set([...alreadyAppended, ...added.map((group) => group.documentId)]),
  };
}

function plainName(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * A quick answer is ranked by the text alone and, once shown, is never reordered: before it is
 * shown, the results named exactly as the query come first, then those whose name carries its
 * words, then the rest — each part in the order the search gave.
 */
export function orderQuickAnswer(response: SearchResponse, query: string): SearchResponse {
  const wanted = plainName(query);
  const rank = (title: string): number =>
    plainName(title) === wanted ? 0 : titleNamesWords(title, query) ? 1 : 2;
  const groups = response.groups
    .map((group, index) => ({ group, index, rank: rank(group.title) }))
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ group }) => group);
  return { ...response, groups };
}
