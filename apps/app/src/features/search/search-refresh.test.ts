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

  it('sees a new document among the first groups or a new order', () => {
    const current = response([group('a', ['1']), group('b', ['2'])]);
    expect(
      sameSearchOutcome(
        current,
        response([group('a', ['1']), group('b', ['2']), group('c', ['3'])]),
      ),
    ).toBe(false);
    expect(sameSearchOutcome(current, response([group('b', ['2']), group('a', ['1'])]))).toBe(
      false,
    );
  });

  it('does not see other passages of the same documents', () => {
    const current = response([group('a', ['1']), group('b', ['2'])]);
    expect(sameSearchOutcome(current, response([group('a', ['1', '4']), group('b', ['9'])]))).toBe(
      true,
    );
  });

  it('does not see a change far down the list', () => {
    const many = (extra: string) =>
      response([
        ...Array.from({ length: 12 }, (_, index) => group(`d${index}`, ['1'])),
        group(extra, ['1']),
      ]);
    expect(sameSearchOutcome(many('x'), many('y'))).toBe(true);
  });
});
