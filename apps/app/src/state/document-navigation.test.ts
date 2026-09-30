import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import { type ExactDocumentIdentity, parseDocumentReadRoute } from '@/state/document-route';
import { loadDocumentTrail } from '@/state/document-trail';
import { decodeOverlayToken } from '@/state/overlay-route';

describe('buildDocumentSectionLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a documents hash without legacy search params', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1',
        pathname: '/app',
        hash: '#/search',
      },
    });

    const link = buildDocumentSectionLink('doc-1', 'section-a');
    expect(link.startsWith('http://127.0.0.1/app#/modules/documents/d/')).toBe(true);
    expect(link.includes('?o=')).toBe(false);
    expect(link.endsWith('#/search')).toBe(false);
    const token = link.slice('http://127.0.0.1/app#/modules/documents/d/'.length);
    expect(decodeOverlayToken(token)).toEqual({
      documentId: 'doc-1',
      section: 'section-a',
    });
  });

  it('writes source constraints into the route and the back-navigation crumb', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', { location: { hash: '#/search', search: '' } });
    const expectedIdentity: ExactDocumentIdentity = {
      type: 'document',
      moduleId: 'module',
      moduleVersion: '1',
      documentId: 'doc-1',
      documentVersionId: 'doc-1@1',
      sourceChecksum: `sha256:${'a'.repeat(64)}`,
      anchor: 'source-anchor',
    };
    openDocumentOverlay('doc-1', 'source-anchor', { expectedIdentity });
    expect(parseDocumentReadRoute(window.location.hash)).toMatchObject({ expectedIdentity });
    expect(loadDocumentTrail()?.crumbs[0]?.href).toBe(window.location.hash);
  });
});
