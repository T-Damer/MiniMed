import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOfficialDocumentHash } from '@/state/document-route';
import {
  appendDocumentCrumb,
  beginDocumentTrail,
  clearDocumentTrail,
  loadDocumentTrail,
  originLabelForView,
  rebuildTrailForPastedRoute,
  sliceTrailToCrumb,
  sliceTrailToOrigin,
  updateCurrentCrumbDocument,
  updateCurrentCrumbTitle,
  viewFromHash,
} from '@/state/document-trail';

function installSessionAndLocation(hash: string, search = ''): void {
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
    location: { hash, search },
  });
}

describe('document-trail', () => {
  beforeEach(() => {
    installSessionAndLocation('#/modules/documents', '');
  });

  afterEach(() => {
    clearDocumentTrail();
    vi.unstubAllGlobals();
  });

  it('maps hash routes to origin views and labels', () => {
    expect(viewFromHash('#/search')).toBe('search');
    expect(viewFromHash('#/modules/documents/medications')).toBe('modules');
    expect(originLabelForView('search', '#/search')).toBe('Поиск');
    expect(originLabelForView('modules', '#/modules/documents')).toBe('Документы');
    expect(originLabelForView('modules', '#/modules/documents/user')).toBe('Ваши документы');
    expect(originLabelForView('modules', '#/modules/documents/user/user-doc-1')).toBe(
      'Ваши документы',
    );
  });

  it('begins a trail from the current location', () => {
    const trail = beginDocumentTrail('official');
    expect(trail.origin).toEqual({
      hash: '#/modules/documents',
      search: '',
      label: 'Документы',
      view: 'modules',
    });
    expect(trail.crumbs).toEqual([]);
    expect(loadDocumentTrail()?.origin.label).toBe('Документы');
  });

  it('appends crumbs and slices back to an existing id', () => {
    let trail = beginDocumentTrail('official');
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'doc-a', title: 'Doc A' });
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'doc-b', title: 'Doc B' });
    expect(trail.crumbs).toHaveLength(2);
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'doc-a', title: 'Doc A again' });
    expect(trail.crumbs).toHaveLength(1);
    expect(trail.crumbs[0]?.title).toBe('Doc A again');
  });

  it('slices to crumbs and origin', () => {
    let trail = beginDocumentTrail('official');
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'doc-a', title: 'Doc A' });
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'doc-b', title: 'Doc B' });
    trail = sliceTrailToCrumb(trail, 0);
    expect(trail.crumbs).toHaveLength(1);
    trail = sliceTrailToOrigin(trail);
    expect(trail.crumbs).toHaveLength(0);
  });

  it('updates the current crumb title and document id', () => {
    let trail = beginDocumentTrail('official');
    trail = appendDocumentCrumb(trail, { kind: 'official', id: 'summary-id', title: 'Loading' });
    trail = updateCurrentCrumbTitle(trail, 'Full title');
    expect(trail.crumbs[0]?.title).toBe('Full title');
    trail = updateCurrentCrumbDocument(trail, 'full-id', 'Full title');
    expect(trail.crumbs[0]?.id).toBe('full-id');
    expect(trail.crumbs[0]?.href).toBe(buildOfficialDocumentHash('full-id'));
  });

  it('rebuilds trail for pasted read routes', () => {
    const trail = rebuildTrailForPastedRoute({
      kind: 'official',
      documentId: 'doc-pasted',
      section: 'anchor',
    });
    expect(trail.origin.label).toBe('Поиск');
    expect(trail.crumbs[0]?.href).toBe(buildOfficialDocumentHash('doc-pasted', 'anchor'));
    const userTrail = rebuildTrailForPastedRoute({ kind: 'user', documentId: 'user-1' });
    expect(userTrail.origin).toEqual({
      hash: '#/modules/documents/user',
      search: '',
      label: 'Ваши документы',
      view: 'modules',
    });
  });

  it('does not treat an existing read hash as the origin', () => {
    installSessionAndLocation('#/modules/documents/d/already-open', '');
    const trail = beginDocumentTrail('official');
    expect(trail.origin).toEqual({
      hash: '#/search',
      search: '',
      label: 'Поиск',
      view: 'search',
    });
  });
});
