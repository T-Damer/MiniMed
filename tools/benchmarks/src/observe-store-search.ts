import type { LexicalHit, LexicalSearchRequest, MedicalStore } from '@localmed/storage';

export interface ObservedSearchCall {
  readonly request: LexicalSearchRequest;
  hits?: readonly LexicalHit[];
}

/** Records the actual production calls; changing a replay limit changes its candidate window. */
export function observeStoreSearch(store: Pick<MedicalStore, 'search'>): ObservedSearchCall[] {
  const calls: ObservedSearchCall[] = [];
  const search = store.search.bind(store);
  store.search = async (request) => {
    const call: ObservedSearchCall = { request };
    calls.push(call);
    call.hits = await search(request);
    return call.hits;
  };
  return calls;
}

export function findObservedBranch(
  calls: readonly ObservedSearchCall[],
  ftsQuery: string,
  candidateCount: number,
): ObservedSearchCall & { hits: readonly LexicalHit[] } {
  const matching = calls.filter(
    (call) => call.request.ftsQuery === ftsQuery && call.hits?.length === candidateCount,
  );
  const first = matching[0];
  if (!first?.hits) throw new Error('Missing production branch execution');
  const identities = (hits: readonly LexicalHit[]) =>
    JSON.stringify(hits.map((hit) => [hit.chunk.id, hit.rank]));
  if (matching.some((call) => call.hits && identities(call.hits) !== identities(first.hits ?? [])))
    throw new Error('Ambiguous production branch execution');
  return { request: first.request, hits: first.hits };
}
