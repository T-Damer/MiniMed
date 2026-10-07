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

/**
 * How old a saved result list is, in words: «только что», «12 мин назад», «3 ч назад», or the
 * date. `now` is injectable for tests.
 */
export function savedSearchAge(savedAt: string, now = Date.now()): string {
  const saved = Date.parse(savedAt);
  if (Number.isNaN(saved)) return 'ранее';
  const minutes = Math.floor((now - saved) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${String(minutes)} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} ч назад`;
  return new Date(saved).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
