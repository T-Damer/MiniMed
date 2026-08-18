import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { countPublishedCatalogModules, viewFromLocation } from '@/app/root-view';
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

  it('maps root and nested hashes onto the six shell tabs', () => {
    expect(viewFromLocation('#/search')).toBe('search');
    expect(viewFromLocation('#/history')).toBe('search');
    expect(viewFromLocation('#/modules/documents')).toBe('modules');
    expect(viewFromLocation('#/documents')).toBe('modules');
    expect(viewFromLocation('#/assessments/psychology')).toBe('assessments');
    expect(viewFromLocation('#/calculators/dose')).toBe('calculators');
    expect(viewFromLocation('#/notes/abc')).toBe('notes');
    expect(viewFromLocation('#/settings')).toBe('settings');
    expect(viewFromLocation('#/settings/downloads')).toBe('settings');
    expect(viewFromLocation('#/modules/model')).toBe('settings');
    expect(viewFromLocation('#/unknown')).toBe('search');
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
