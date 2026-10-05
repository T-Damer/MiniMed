export const NEWS_ROOT_HASH = '#/news';
export const NEWS_ADD_HASH = '#/news/add';
export const NEWS_SOURCES_HASH = '#/news/sources';

export type NewsRoute =
  | { readonly kind: 'list' }
  | { readonly kind: 'add' }
  | { readonly kind: 'sources' }
  /** A cached feed item, read in the viewer. */
  | { readonly kind: 'item'; readonly itemId: string }
  /** A website subscription, opened in the viewer. */
  | { readonly kind: 'site'; readonly feedId: string };

export function newsItemHash(itemId: string): string {
  return `${NEWS_ROOT_HASH}/item/${encodeURIComponent(itemId)}`;
}

export function newsSiteHash(feedId: string): string {
  return `${NEWS_ROOT_HASH}/site/${encodeURIComponent(feedId)}`;
}

function newsSegments(route: string): readonly string[] | null {
  const segments = route
    .replace(/^#?\/?/u, '')
    .split(/[?#]/u)[0]
    ?.split('/')
    .filter(Boolean);
  if (segments?.[0] !== 'news') return null;
  return segments.slice(1);
}

export function isNewsRoute(route: string): boolean {
  return newsSegments(route) !== null;
}

function decode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function readNewsRoute(hash = window.location.hash): NewsRoute {
  const [section, id] = newsSegments(hash) ?? [];
  if (section === 'add') return { kind: 'add' };
  if (section === 'sources') return { kind: 'sources' };
  const decoded = decode(id);
  if (section === 'item' && decoded) return { kind: 'item', itemId: decoded };
  if (section === 'site' && decoded) return { kind: 'site', feedId: decoded };
  return { kind: 'list' };
}

/** Where Back leads from a news route; the list itself has no parent (Back goes to search). */
export function newsParentHash(route: string): string | null {
  if (newsSegments(route) === null) return null;
  return readNewsRoute(`#/${route.replace(/^#?\/?/u, '')}`).kind === 'list' ? null : NEWS_ROOT_HASH;
}
