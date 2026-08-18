import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isUserLibraryCatalogRoute,
  migrateLegacyUserDocumentHash,
  openUserLibraryCatalog,
  openUserLibraryDocument,
  parseUserLibraryDocumentRoute,
  USER_LIBRARY_CATALOG_HASH,
  USER_LIBRARY_CATALOG_ROUTE,
  userLibraryDocumentHash,
} from '@/features/library/user-library-routing';
import { buildUserDocumentHash } from '@/state/document-route';

describe('user-library routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognizes the user library catalog route', () => {
    expect(isUserLibraryCatalogRoute(USER_LIBRARY_CATALOG_ROUTE)).toBe(true);
    expect(parseUserLibraryDocumentRoute(USER_LIBRARY_CATALOG_ROUTE)).toBeNull();
  });

  it('builds module user document hashes', () => {
    expect(userLibraryDocumentHash('user-doc-1')).toBe('#/modules/documents/user/user-doc-1');
    expect(userLibraryDocumentHash('user-doc-1', 2)).toBe(
      '#/modules/documents/user/user-doc-1/p/2',
    );
  });

  it('parses document routes with optional page index', () => {
    expect(parseUserLibraryDocumentRoute('modules/documents/user/user-doc-1')).toEqual({
      documentId: 'user-doc-1',
    });
    expect(parseUserLibraryDocumentRoute('modules/documents/user/user-doc-1/p/3')).toEqual({
      documentId: 'user-doc-1',
      pageIndex: 3,
    });
    expect(parseUserLibraryDocumentRoute('modules/documents/user/user-doc-1/extra')).toBeNull();
  });

  it('does not migrate the user library catalog route', () => {
    const location = {
      hash: USER_LIBRARY_CATALOG_HASH,
      search: '',
      pathname: '/app',
      origin: 'http://127.0.0.1',
      href: `http://127.0.0.1/app${USER_LIBRARY_CATALOG_HASH}`,
    };
    vi.stubGlobal('window', {
      location,
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => {
          location.hash = url;
        },
      },
    });
    expect(migrateLegacyUserDocumentHash()).toBe(false);
    expect(location.hash).toBe(USER_LIBRARY_CATALOG_HASH);
  });

  it('migrates leftover #/read/user hashes to module routes', () => {
    const location = {
      hash: '#/read/user/user-doc-1/2',
      search: '',
      pathname: '/app',
      origin: 'http://127.0.0.1',
      href: 'http://127.0.0.1/app#/read/user/user-doc-1/2',
    };
    vi.stubGlobal('window', {
      location,
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => {
          location.hash = url;
        },
      },
    });
    expect(migrateLegacyUserDocumentHash()).toBe(true);
    expect(location.hash).toBe('#/modules/documents/user/user-doc-1/p/2');
  });

  it('does not migrate already-nested user document hashes', () => {
    const location = {
      hash: buildUserDocumentHash('user-doc-1', 2),
      search: '',
      pathname: '/app',
      origin: 'http://127.0.0.1',
      href: `http://127.0.0.1/app${buildUserDocumentHash('user-doc-1', 2)}`,
    };
    vi.stubGlobal('window', {
      location,
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => {
          location.hash = url;
        },
      },
    });
    expect(migrateLegacyUserDocumentHash()).toBe(false);
    expect(location.hash).toBe(buildUserDocumentHash('user-doc-1', 2));
  });

  it('opens the user library catalog hash', () => {
    vi.stubGlobal('window', { location: { hash: '#/modules/documents' } });
    openUserLibraryCatalog();
    expect(window.location.hash).toBe(USER_LIBRARY_CATALOG_HASH);
  });

  it('navigates to the module route when opening a user document', () => {
    const sessionStore = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => sessionStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        sessionStore.set(key, value);
      },
      removeItem: (key: string) => {
        sessionStore.delete(key);
      },
    });
    vi.stubGlobal('window', {
      location: { hash: '#/modules/documents/user', search: '' },
    });

    openUserLibraryDocument({ documentId: 'user-doc-1', pageIndex: 1, title: 'Книга' });
    expect(window.location.hash).toBe(buildUserDocumentHash('user-doc-1', 1));
  });
});
