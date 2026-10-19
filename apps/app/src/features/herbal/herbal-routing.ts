export const HERBAL_BOOK_ROUTE = 'modules/documents/herbal';
export const HERBAL_BOOK_HASH = `#/${HERBAL_BOOK_ROUTE}`;

export function isHerbalBookRoute(hashOrRoute: string): boolean {
  const route = hashOrRoute.replace(/^#\/?/u, '').split('?', 1)[0] ?? '';
  return route === HERBAL_BOOK_ROUTE;
}

/** The action filter kept in the address, so Back and tab round trips restore it. */
export function herbalBookActionFromHash(hash: string): string | null {
  const query = hash.split('?', 2)[1];
  if (!query) return null;
  const action = new URLSearchParams(query).get('action');
  return action?.trim() ? action.trim() : null;
}

export function herbalBookHash(action: string | null): string {
  return action
    ? `${HERBAL_BOOK_HASH}?${new URLSearchParams({ action }).toString()}`
    : HERBAL_BOOK_HASH;
}
