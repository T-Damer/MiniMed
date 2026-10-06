import type { SearchResponse } from '@localmed/contracts';

function outcomeKey(response: SearchResponse): string {
  const groups = response.groups.map(
    (group) =>
      `${group.documentId}:${group.contentKind ?? ''}:${group.results.map((result) => result.chunkId).join(',')}`,
  );
  const identities = (response.identities ?? []).map((hit) => JSON.stringify(hit.target));
  return JSON.stringify([groups, identities, response.queryRewrite?.query ?? null]);
}

/**
 * True when a refreshed search shows what is already on screen: the same documents with the same
 * fragments, the same dictionary entries and the same rewrite. Such a refresh is applied silently;
 * anything else waits behind «Обновить» so the list never changes under the reader's finger.
 */
export function sameSearchOutcome(current: SearchResponse, next: SearchResponse): boolean {
  return outcomeKey(current) === outcomeKey(next);
}
