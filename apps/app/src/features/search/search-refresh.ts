import type { SearchResponse } from '@localmed/contracts';

/** The groups a reader sees without scrolling far; a change further down is not worth a prompt. */
const COMPARED_GROUPS = 12;

function outcomeKey(response: SearchResponse): string {
  // Documents and their order, not the fragments inside them: a re-run that only picks other
  // passages of the same documents shows the reader nothing new.
  const groups = response.groups
    .slice(0, COMPARED_GROUPS)
    .map((group) => `${group.documentId}:${group.contentKind ?? ''}`);
  const identities = (response.identities ?? []).map((hit) => JSON.stringify(hit.target));
  return JSON.stringify([
    groups,
    identities,
    response.queryRewrite?.query ?? null,
    response.queryCorrection?.correctedQuery ?? null,
  ]);
}

/**
 * True when a refreshed search shows what is already on screen: the same first documents in the
 * same order, the same dictionary entries and the same rewrite or correction. Such a refresh is
 * applied silently; a different one waits behind «Обновить» (only after installed content changed,
 * SearchWorkspace) so the list never changes under the reader's finger.
 */
export function sameSearchOutcome(current: SearchResponse, next: SearchResponse): boolean {
  return outcomeKey(current) === outcomeKey(next);
}
