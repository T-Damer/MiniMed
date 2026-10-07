import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  rememberDocumentSummaries,
  resetDocumentTitleHintsForTests,
} from '@/features/library/document-title-hints';

import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import {
  buildOfficialDocumentHash,
  type ExactDocumentIdentity,
  parseDocumentReadRoute,
} from '@/state/document-route';
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

describe('openDocumentOverlay', () => {
  const POINTER = 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac';

  function stubBrowser(hash: string) {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const location = { hash, search: '', href: `http://127.0.0.1/${hash}` };
    const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
      location.hash = next;
      location.href = `http://127.0.0.1/${next}`;
    });
    const dispatchEvent = vi.fn();
    vi.stubGlobal(
      'HashChangeEvent',
      class {
        public constructor(
          public readonly type: string,
          public readonly init: { readonly oldURL: string; readonly newURL: string },
        ) {}
      },
    );
    vi.stubGlobal('window', { location, history: { state: null, replaceState }, dispatchEvent });
    return { location, replaceState, dispatchEvent };
  }

  afterEach(() => {
    resetDocumentTitleHintsForTests();
    vi.unstubAllGlobals();
  });

  it('names the crumb from a title the app already knows instead of «Открываем документ»', () => {
    stubBrowser('#/search');
    rememberDocumentSummaries([
      {
        id: 'kr.rf.1006_1',
        title: 'Острая ишемия конечностей',
        shortTitle: null,
        sourceType: 'clinical_recommendation',
        metadata: {},
      },
    ]);
    openDocumentOverlay('kr.rf.1006_1');
    expect(loadDocumentTrail()?.crumbs[0]?.title).toBe('Острая ишемия конечностей');
  });

  it('falls back to the placeholder only for a document nobody has named', () => {
    stubBrowser('#/search');
    openDocumentOverlay('kr.rf.unknown');
    expect(loadDocumentTrail()?.crumbs[0]?.title).toBe('Открываем документ');
  });

  it('a pointer redirect replaces the history entry and its crumb, so back skips the pointer', () => {
    const { location, replaceState, dispatchEvent } = stubBrowser('#/search');
    openDocumentOverlay(POINTER);
    location.hash = parseHashFor(POINTER);
    openDocumentOverlay('kr.rf.1006_1', null, {
      preferSummary: true,
      replace: true,
      title: 'Острая ишемия конечностей',
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(parseDocumentReadRoute(location.hash)).toMatchObject({ documentId: 'kr.rf.1006_1' });
    // The route listeners are told, since replaceState alone raises no event.
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const crumbs = loadDocumentTrail()?.crumbs ?? [];
    expect(crumbs.map((crumb) => crumb.id)).toEqual(['kr.rf.1006_1']);
    expect(crumbs[0]?.title).toBe('Острая ишемия конечностей');
  });

  it('an ordinary open sets the hash and leaves history to the browser', () => {
    const { location, replaceState } = stubBrowser('#/search');
    openDocumentOverlay('doc-1');
    expect(replaceState).not.toHaveBeenCalled();
    expect(parseDocumentReadRoute(location.hash)).toMatchObject({ documentId: 'doc-1' });
  });
});

function parseHashFor(documentId: string): string {
  return buildOfficialDocumentHash(documentId);
}
