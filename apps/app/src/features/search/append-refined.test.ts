import type { SearchResponse, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { appendRefinedResponse, orderQuickAnswer } from '@/features/search/append-refined';

const group = (documentId: string, title = documentId): SearchResultGroup =>
  ({
    documentId,
    title,
    bestScore: 1,
    categories: [],
    results: [],
  }) as unknown as SearchResultGroup;
const response = (ids: readonly string[], patch: Partial<SearchResponse> = {}): SearchResponse =>
  ({
    requestId: 'r',
    normalizedQuery: 'q',
    groups: ids.map((id) => group(id)),
    ...patch,
  }) as SearchResponse;

describe('a later answer is added under the results on screen', () => {
  it('keeps the shown groups in place and appends only the new ones', () => {
    const shown = response(['b', 'a'], { partial: true });
    const refined = response(['c', 'a', 'd', 'b']);
    const { response: merged, appended } = appendRefinedResponse(shown, refined);
    expect(merged.groups.map((item) => item.documentId)).toEqual(['b', 'a', 'c', 'd']);
    expect([...appended]).toEqual(['c', 'd']);
    // The shown cards are the very same objects: nothing in them is re-rendered.
    expect(merged.groups[0]).toBe(shown.groups[0]);
    expect(merged.partial).toBeUndefined();
  });

  it('takes the later answer whole when nothing was shown', () => {
    const refined = response(['a', 'b']);
    const { response: merged, appended } = appendRefinedResponse(response([]), refined);
    expect(merged).toBe(refined);
    expect(appended.size).toBe(0);
  });

  it('keeps earlier additions marked across a second refinement', () => {
    const first = appendRefinedResponse(response(['a']), response(['a', 'b']));
    const second = appendRefinedResponse(first.response, response(['c', 'a']), first.appended);
    expect(second.response.groups.map((item) => item.documentId)).toEqual(['a', 'b', 'c']);
    expect([...second.appended].toSorted()).toEqual(['b', 'c']);
  });
});

describe('a quick answer before it is shown', () => {
  it('leads with the results named as the query, then those whose name carries it', () => {
    const quick = {
      ...response([]),
      groups: [
        group('lobar', 'Долевая пневмония'),
        group('text', 'Острый бронхит'),
        group('exact', 'Пневмония'),
        group('kids', 'Пневмония у детей'),
      ],
    } as SearchResponse;
    expect(orderQuickAnswer(quick, 'пневмония').groups.map((item) => item.documentId)).toEqual([
      'exact',
      'lobar',
      'kids',
      'text',
    ]);
  });
});
