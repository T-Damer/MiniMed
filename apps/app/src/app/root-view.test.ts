import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compactRootView,
  countPublishedCatalogModules,
  ROOT_VIEWS,
  rootViewRestoresRoute,
  viewFromLocation,
} from '@/app/root-view';
import { clearDocumentTrail } from '@/state/document-trail';

function installSessionStorage(): void {
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
}

describe('viewFromLocation', () => {
  beforeEach(() => {
    installSessionStorage();
  });

  afterEach(() => {
    clearDocumentTrail();
    vi.unstubAllGlobals();
  });

  it('maps root and nested hashes onto the seven shell tabs', () => {
    expect(viewFromLocation('#/search')).toBe('search');
    expect(viewFromLocation('#/history')).toBe('search');
    expect(viewFromLocation('#/modules/documents')).toBe('modules');
    expect(viewFromLocation('#/documents')).toBe('modules');
    expect(viewFromLocation('#/assessments/psychology')).toBe('assessments');
    expect(viewFromLocation('#/calculators/dose')).toBe('calculators');
    expect(viewFromLocation('#/notes/abc')).toBe('notes');
    expect(viewFromLocation('#/news')).toBe('news');
    expect(viewFromLocation('#/news/item/i-1')).toBe('news');
    expect(viewFromLocation('#/news/sources')).toBe('news');
    expect(viewFromLocation('#/settings')).toBe('settings');
    expect(viewFromLocation('#/settings/downloads')).toBe('settings');
    expect(viewFromLocation('#/modules/model')).toBe('settings');
    expect(viewFromLocation('#/unknown')).toBe('search');
  });

  it('groups reference routes under search and keeps personal files separate', () => {
    expect(compactRootView('calculators', '#/calculators/units')).toBe('search');
    expect(compactRootView('modules', '#/modules/documents')).toBe('search');
    expect(compactRootView('modules', '#/modules/documents/user')).toBe('notes');
    expect(compactRootView('modules', '#/modules/documents/user/doc-1')).toBe('notes');
    expect(compactRootView('notes', '#/notes')).toBe('notes');
    expect(compactRootView('settings', '#/settings/downloads')).toBe('settings');
    expect(compactRootView('news', '#/news/add')).toBe('news');
  });

  it('keeps official document reads on search when no trail is stored', () => {
    expect(viewFromLocation('#/modules/documents/d/token')).toBe('search');
  });

  it('keeps user document reads on the knowledge tab when no trail is stored', () => {
    expect(viewFromLocation('#/modules/documents/user/doc-1')).toBe('modules');
  });
});

describe('countPublishedCatalogModules', () => {
  it('counts published modules and skips individual recommendations', () => {
    expect(
      countPublishedCatalogModules([
        { releaseState: 'published', tags: [] },
        { releaseState: 'draft', tags: [] },
        { releaseState: 'published', tags: ['individual-recommendation'] },
      ]),
    ).toBe(1);
  });
});

describe('rootViewRestoresRoute', () => {
  it('lets only the calculators tab open at its list', () => {
    expect(
      ROOT_VIEWS.filter((item) => !rootViewRestoresRoute(item.id)).map((item) => item.id),
    ).toEqual(['calculators']);
  });
});
