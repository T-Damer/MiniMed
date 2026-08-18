import { describe, expect, it, vi } from 'vitest';

import { navigateDocumentReaderBack } from '@/features/library/document-reader-back';
import type { DocumentTrail } from '@/state/document-trail';

describe('navigateDocumentReaderBack', () => {
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
