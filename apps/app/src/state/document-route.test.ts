import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildOfficialDocumentHash,
  buildUserDocumentHash,
  isDocumentReadRoute,
  migrateLegacyDocumentHash,
  migrateLegacyOverlaySearch,
  parseDocumentReadRoute,
} from '@/state/document-route';
import { decodeOverlayToken, encodeOverlayToken } from '@/state/overlay-route';

function installLocation(initial: { hash?: string; search?: string; href?: string }): void {
  const location = {
    hash: initial.hash ?? '',
    search: initial.search ?? '',
    pathname: '/app',
    origin: 'http://127.0.0.1',
    href: initial.href ?? `http://127.0.0.1/app${initial.search ?? ''}${initial.hash ?? ''}`,
  };
  const syncHref = (): void => {
    location.href = `${location.origin}${location.pathname}${location.search}${location.hash}`;
  };
  vi.stubGlobal('window', {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: string | URL) => {
        const href = typeof url === 'string' ? url : url.href;
        if (href.startsWith('#')) {
          location.hash = href;
          syncHref();
          return;
        }
        const parsed = new URL(href, location.href);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
        syncHref();
      },
      state: null,
    },
  });
}

describe('document-route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects nested document hashes and leftover #/read routes', () => {
    const token = encodeOverlayToken({ documentId: 'doc-1' });
    expect(isDocumentReadRoute(`#/modules/documents/d/${token}`)).toBe(true);
    expect(isDocumentReadRoute('#/modules/documents/user/doc-1')).toBe(true);
    expect(isDocumentReadRoute('#/read/abc')).toBe(true);
    expect(isDocumentReadRoute('#/read/user/doc-1')).toBe(true);
    expect(isDocumentReadRoute('#/modules/documents/user')).toBe(false);
    expect(isDocumentReadRoute('#/modules/documents')).toBe(false);
    expect(isDocumentReadRoute('#/search')).toBe(false);
  });

  it('parses official document routes from encoded tokens', () => {
    const token = encodeOverlayToken({ documentId: 'kr.rf.928_1', section: 'anchor-a' });
    expect(parseDocumentReadRoute(`#/modules/documents/d/${token}`)).toEqual({
      kind: 'official',
      documentId: 'kr.rf.928_1',
      section: 'anchor-a',
    });
    expect(parseDocumentReadRoute(`#/read/${token}`)).toEqual({
      kind: 'official',
      documentId: 'kr.rf.928_1',
      section: 'anchor-a',
    });
    const bare = encodeOverlayToken({ documentId: 'doc-1' });
    expect(parseDocumentReadRoute(`#/modules/documents/d/${bare}`)).toEqual({
      kind: 'official',
      documentId: 'doc-1',
    });
  });

  it('parses user library routes with optional page index', () => {
    expect(parseDocumentReadRoute('#/modules/documents/user/user-doc-1')).toEqual({
      kind: 'user',
      documentId: 'user-doc-1',
    });
    expect(parseDocumentReadRoute('#/modules/documents/user/user-doc-1/p/3')).toEqual({
      kind: 'user',
      documentId: 'user-doc-1',
      pageIndex: 3,
    });
    expect(parseDocumentReadRoute('#/read/user/user-doc-1')).toEqual({
      kind: 'user',
      documentId: 'user-doc-1',
    });
    expect(parseDocumentReadRoute('#/read/user/user-doc-1/3')).toEqual({
      kind: 'user',
      documentId: 'user-doc-1',
      pageIndex: 3,
    });
  });

  it('builds official and user hashes under the documents namespace', () => {
    const hash = buildOfficialDocumentHash('doc-1', 'section-a');
    expect(hash.startsWith('#/modules/documents/d/')).toBe(true);
    const token = hash.slice('#/modules/documents/d/'.length);
    expect(decodeOverlayToken(token)).toEqual({ documentId: 'doc-1', section: 'section-a' });
    expect(buildUserDocumentHash('user-doc-1')).toBe('#/modules/documents/user/user-doc-1');
    expect(buildUserDocumentHash('user-doc-1', 2)).toBe('#/modules/documents/user/user-doc-1/p/2');
  });

  it('migrates leftover #/read hashes into the documents namespace', () => {
    const token = encodeOverlayToken({ documentId: 'doc-legacy', section: 's-1' });
    installLocation({ hash: `#/read/${token}` });
    expect(migrateLegacyDocumentHash()).toBe(true);
    expect(window.location.hash).toBe(buildOfficialDocumentHash('doc-legacy', 's-1'));
    expect(window.location.pathname).toBe('/app');

    installLocation({ hash: '#/read/user/user-doc-1/2' });
    expect(migrateLegacyDocumentHash()).toBe(true);
    expect(window.location.hash).toBe(buildUserDocumentHash('user-doc-1', 2));
    expect(window.location.pathname).toBe('/app');
  });

  it('does not migrate already-nested document hashes', () => {
    installLocation({ hash: buildUserDocumentHash('user-doc-1', 2) });
    expect(migrateLegacyDocumentHash()).toBe(false);
    expect(window.location.hash).toBe(buildUserDocumentHash('user-doc-1', 2));
  });

  it('migrates legacy overlay search params to the documents hash', () => {
    const token = encodeOverlayToken({ documentId: 'doc-legacy', section: 's-1' });
    installLocation({ hash: '#/search', search: `?o=${token}` });
    expect(migrateLegacyOverlaySearch()).toBe(true);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe(buildOfficialDocumentHash('doc-legacy', 's-1'));
    expect(window.location.pathname).toBe('/app');
  });
});
