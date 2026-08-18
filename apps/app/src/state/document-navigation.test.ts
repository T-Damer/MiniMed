import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDocumentSectionLink } from '@/state/document-navigation';
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
});
