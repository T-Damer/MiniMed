import {
  decodeOverlayToken,
  encodeOverlayToken,
  overlayFromLocationSearch,
  stripOverlaySearch,
} from '@/state/overlay-route';

export const OFFICIAL_DOCUMENT_ROUTE_PREFIX = 'modules/documents/d/';
export const USER_DOCUMENT_ROUTE_PREFIX = 'modules/documents/user/';

export interface OfficialDocumentReadRoute {
  readonly kind: 'official';
  readonly documentId: string;
  readonly section?: string;
}

export interface UserDocumentReadRoute {
  readonly kind: 'user';
  readonly documentId: string;
  readonly pageIndex?: number;
}

export type DocumentReadRoute = OfficialDocumentReadRoute | UserDocumentReadRoute;

export function isDocumentReadRoute(hash: string): boolean {
  const route = hash.replace(/^#\/?/u, '');
  if (route.startsWith(OFFICIAL_DOCUMENT_ROUTE_PREFIX)) return true;
  if (route.startsWith(USER_DOCUMENT_ROUTE_PREFIX)) return true;
  return route.startsWith('read/');
}

function decodeRoutePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseUserDocumentRoute(route: string): UserDocumentReadRoute | null {
  if (!route.startsWith(USER_DOCUMENT_ROUTE_PREFIX)) return null;
  const rest = route.slice(USER_DOCUMENT_ROUTE_PREFIX.length);
  if (!rest) return null;
  const segments = rest.split('/');
  const documentId = decodeRoutePart(segments[0] ?? '');
  if (!documentId) return null;
  if (segments.length === 1) return { kind: 'user', documentId };
  if (segments.length === 3 && segments[1] === 'p') {
    const pageIndex = Number.parseInt(segments[2] ?? '', 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
    return { kind: 'user', documentId, pageIndex };
  }
  return null;
}

export function parseDocumentReadRoute(hash: string): DocumentReadRoute | null {
  const route = hash.replace(/^#\/?/u, '');
  if (route.startsWith(OFFICIAL_DOCUMENT_ROUTE_PREFIX)) {
    const token = route.slice(OFFICIAL_DOCUMENT_ROUTE_PREFIX.length).split('/')[0] ?? '';
    const decoded = decodeOverlayToken(token);
    if (!decoded) return null;
    return decoded.section
      ? { kind: 'official', documentId: decoded.documentId, section: decoded.section }
      : { kind: 'official', documentId: decoded.documentId };
  }
  const userRoute = parseUserDocumentRoute(route);
  if (userRoute) return userRoute;
  if (!route.startsWith('read/')) return null;
  const rest = route.slice('read/'.length);
  if (!rest) return null;

  if (rest.startsWith('user/')) {
    const segments = rest.slice('user/'.length).split('/');
    const documentId = decodeRoutePart(segments[0] ?? '');
    if (!documentId) return null;
    if (segments.length === 1) {
      return { kind: 'user', documentId };
    }
    const pageIndex = Number.parseInt(segments[1] ?? '', 10);
    if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
    return { kind: 'user', documentId, pageIndex };
  }

  const token = rest.split('/')[0] ?? '';
  const decoded = decodeOverlayToken(token);
  if (!decoded) return null;
  return decoded.section
    ? { kind: 'official', documentId: decoded.documentId, section: decoded.section }
    : { kind: 'official', documentId: decoded.documentId };
}

export function buildOfficialDocumentHash(documentId: string, section?: string): string {
  const token = encodeOverlayToken(section ? { documentId, section } : { documentId });
  return `#/${OFFICIAL_DOCUMENT_ROUTE_PREFIX}${token}`;
}

export function buildUserDocumentHash(documentId: string, pageIndex?: number): string {
  const encoded = encodeURIComponent(documentId);
  if (pageIndex === undefined) return `#/${USER_DOCUMENT_ROUTE_PREFIX}${encoded}`;
  return `#/${USER_DOCUMENT_ROUTE_PREFIX}${encoded}/p/${pageIndex}`;
}

export function migrateLegacyDocumentHash(): boolean {
  const route = window.location.hash.replace(/^#\/?/u, '');
  if (!route.startsWith('read/')) return false;
  const parsed = parseDocumentReadRoute(`#/${route}`);
  if (!parsed) return false;
  const nextHash =
    parsed.kind === 'user'
      ? parsed.pageIndex === undefined
        ? buildUserDocumentHash(parsed.documentId)
        : buildUserDocumentHash(parsed.documentId, parsed.pageIndex)
      : parsed.section === undefined
        ? buildOfficialDocumentHash(parsed.documentId)
        : buildOfficialDocumentHash(parsed.documentId, parsed.section);
  window.history.replaceState(window.history.state, '', nextHash);
  return true;
}

export function migrateLegacyOverlaySearch(): boolean {
  const overlay = overlayFromLocationSearch(window.location.search);
  if (!overlay) return false;
  const url = new URL(window.location.href);
  stripOverlaySearch(url);
  url.hash = overlay.section
    ? buildOfficialDocumentHash(overlay.documentId, overlay.section)
    : buildOfficialDocumentHash(overlay.documentId);
  window.history.replaceState(window.history.state, '', url);
  return true;
}
