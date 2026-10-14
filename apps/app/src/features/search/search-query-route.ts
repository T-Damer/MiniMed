/**
 * The search query in the address (SRCH1): `#/search?q=аспирин`, `#/search/section/medications?q=…`.
 * A reload, a shared link and a return to the entry restore the query. Only the encoding, the
 * decoding and the rewrite of the address live here; which history entry the address belongs to
 * (push or replace) is decided by the navigation code, and this module only ever replaces the
 * current entry with the same path.
 */

/** Longest query kept in the address; a pasted case history is not a link. */
export const MAX_QUERY_IN_HASH = 300;

const SEARCH_HASH = '#/search';
const SEARCH_PATH = /^#\/search(?:\/[a-z-]+(?:\/[a-z-]+)?)?\/?$/u;

/** The part of a hash before «?»: `#/search?q=x` → `#/search`. */
export function hashPath(hash: string): string {
  const mark = hash.indexOf('?');
  return mark < 0 ? hash : hash.slice(0, mark);
}

/** True for the search page's own addresses, with or without a query. */
export function isSearchHash(hash: string): boolean {
  return SEARCH_PATH.test(hashPath(hash));
}

/** The query a search address carries, or undefined (no parameter, empty, or not a search address). */
export function searchQueryFromHash(hash: string): string | undefined {
  if (!isSearchHash(hash)) return undefined;
  const mark = hash.indexOf('?');
  if (mark < 0) return undefined;
  let value: string | null;
  try {
    value = new URLSearchParams(hash.slice(mark + 1)).get('q');
  } catch {
    return undefined;
  }
  const query = value?.replaceAll(/\s+/gu, ' ').trim();
  return query ? query.slice(0, MAX_QUERY_IN_HASH) : undefined;
}

/** The address with this query: the path stays, the parameter is set, or removed for an empty query. */
export function hashWithSearchQuery(hash: string, query: string | undefined): string {
  const path = hashPath(hash);
  const clean = query?.replaceAll(/\s+/gu, ' ').trim().slice(0, MAX_QUERY_IN_HASH);
  if (!clean) return path;
  return `${path}?${new URLSearchParams({ q: clean }).toString().replaceAll('+', '%20')}`;
}

/**
 * Writes the query into the current entry's address. Nothing happens when the page is not on a
 * search address (the user already moved to another tab) or when the address is already right.
 */
export function replaceSearchQueryInAddress(query: string | undefined): void {
  const hash = window.location.hash;
  // The bare address is the search page itself.
  const path = hash === '' || hash === '#' || hash === '#/' ? SEARCH_HASH : hash;
  if (!isSearchHash(path)) return;
  const next = hashWithSearchQuery(path, query);
  if (next === hash || (hash === '' && next === SEARCH_HASH)) return;
  window.history.replaceState(window.history.state, '', next);
}
