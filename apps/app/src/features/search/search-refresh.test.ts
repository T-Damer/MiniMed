import type { SearchResponse, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { sameSearchOutcome } from '@/features/search/search-refresh';

function group(documentId: string, chunkIds: readonly string[]): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: [],
    results: chunkIds.map((chunkId) => ({ chunkId }) as SearchResultGroup['results'][number]),
  };
}

function response(groups: readonly SearchResultGroup[], requestId = 'a'): SearchResponse {
  return { requestId, groups } as unknown as SearchResponse;
}

describe('sameSearchOutcome', () => {
  it('ignores request ids and timings when the same fragments come back', () => {
    expect(
      sameSearchOutcome(
        response([group('a', ['1', '2'])], 'first'),
        response([group('a', ['1', '2'])], 'second'),
      ),
    ).toBe(true);
  });

  it('sees a new document, a new fragment or a new order', () => {
    const current = response([group('a', ['1']), group('b', ['2'])]);
    expect(
      sameSearchOutcome(
        current,
        response([group('a', ['1']), group('b', ['2']), group('c', ['3'])]),
      ),
    ).toBe(false);
    expect(sameSearchOutcome(current, response([group('a', ['1', '4']), group('b', ['2'])]))).toBe(
      false,
    );
    expect(sameSearchOutcome(current, response([group('b', ['2']), group('a', ['1'])]))).toBe(
      false,
    );
  });
});
