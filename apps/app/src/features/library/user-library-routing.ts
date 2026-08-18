import { buildUserDocumentHash, migrateLegacyDocumentHash } from '@/state/document-route';
import { appendDocumentCrumb, beginDocumentTrail, loadDocumentTrail } from '@/state/document-trail';

export const USER_LIBRARY_CATALOG_ROUTE = 'modules/documents/user';
export const USER_LIBRARY_CATALOG_HASH = '#/modules/documents/user';
export const USER_LIBRARY_DOCUMENT_ROUTE_PREFIX = 'modules/documents/user/';

function decodeRoutePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function isUserLibraryCatalogRoute(route: string): boolean {
  return route === USER_LIBRARY_CATALOG_ROUTE;
}

export function openUserLibraryCatalog(): void {
  window.location.hash = USER_LIBRARY_CATALOG_HASH;
}

export function parseUserLibraryDocumentRoute(
  route: string,
): { documentId: string; pageIndex?: number } | null {
  if (!route.startsWith(USER_LIBRARY_DOCUMENT_ROUTE_PREFIX)) {
    return null;
  }
  const rest = route.slice(USER_LIBRARY_DOCUMENT_ROUTE_PREFIX.length);
  if (!rest) return null;

  const segments = rest.split('/');
  const documentId = decodeRoutePart(segments[0] ?? '');
  if (!documentId) return null;

  if (segments.length === 1) {
    return { documentId };
  }

  if (segments.length === 3 && segments[1] === 'p') {
    const pageIndex = Number.parseInt(segments[2] ?? '', 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return null;
    }
    return { documentId, pageIndex };
  }

  return null;
}

export function userLibraryDocumentHash(documentId: string, pageIndex?: number): string {
  return pageIndex === undefined
    ? buildUserDocumentHash(documentId)
    : buildUserDocumentHash(documentId, pageIndex);
}

export function migrateLegacyUserDocumentHash(): boolean {
  return migrateLegacyDocumentHash();
}

export function openUserLibraryDocument(request: {
  documentId: string;
  pageIndex?: number;
  title?: string;
}): void {
  let trail = loadDocumentTrail();
  if (!trail || trail.crumbs.length === 0) {
    trail = beginDocumentTrail('user');
  }
  appendDocumentCrumb(trail, {
    kind: 'user',
    id: request.documentId,
    title: request.title ?? 'Личный документ',
    ...(request.pageIndex === undefined ? {} : { pageIndex: request.pageIndex }),
  });
  window.location.hash =
    request.pageIndex === undefined
      ? buildUserDocumentHash(request.documentId)
      : buildUserDocumentHash(request.documentId, request.pageIndex);
}
