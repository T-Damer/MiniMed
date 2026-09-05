import { describe, expect, it, vi } from 'vitest';

import { navigateDocumentReaderBack } from '@/features/library/document-reader-back';
import type { DocumentTrail } from '@/state/document-trail';

describe('navigateDocumentReaderBack', () => {
  it('returns to the previous linked document before the trail origin', () => {
    const onNavigate = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal('sessionStorage', { setItem });
    const trail: DocumentTrail = {
      origin: {
        hash: '#/search',
        search: '',
        label: 'Поиск',
        view: 'search',
      },
      crumbs: [
        { kind: 'official', id: 'a', title: 'Документ A', href: '#/modules/documents/d/a' },
        { kind: 'official', id: 'b', title: 'Документ B', href: '#/modules/documents/d/b' },
      ],
    };

    navigateDocumentReaderBack(trail, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('#/modules/documents/d/a');
    expect(setItem).toHaveBeenCalledWith(
      'minimed:document-trail',
      expect.stringContaining('"id":"a"'),
    );
    vi.unstubAllGlobals();
  });

  it('uses trail origin when present', () => {
    const onNavigate = vi.fn();
    const trail: DocumentTrail = {
      origin: {
        hash: '#/modules/documents/collection/regulatory',
        search: '',
        label: 'Документы',
        view: 'modules',
      },
      crumbs: [],
    };

    navigateDocumentReaderBack(trail, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('#/modules/documents/collection/regulatory');
  });
});
