import { describe, expect, it } from 'vitest';

import {
  isSameDocumentReadRoute,
  shouldReloadOfficialDocument,
} from '@/features/library/document-page-load';

describe('shouldReloadOfficialDocument', () => {
  it('skips reload when the same document is already loaded', () => {
    expect(shouldReloadOfficialDocument('kr.rf.264_2', 'kr.rf.264_2', null)).toBe(false);
  });

  it('skips reload when the same document id is already in flight', () => {
    expect(shouldReloadOfficialDocument(undefined, 'kr.rf.264_2', 'kr.rf.264_2')).toBe(false);
  });

  it('reloads when the document id changes', () => {
    expect(shouldReloadOfficialDocument('kr.rf.264_2', 'kr.rf.281_3', null)).toBe(true);
    expect(shouldReloadOfficialDocument(undefined, 'kr.rf.264_2', 'kr.rf.281_3')).toBe(true);
  });
});

describe('isSameDocumentReadRoute', () => {
  it('matches identical official and user routes', () => {
    expect(
      isSameDocumentReadRoute(
        { kind: 'official', documentId: 'esklp.mnn.risperidon', section: 'dose' },
        { kind: 'official', documentId: 'esklp.mnn.risperidon', section: 'dose' },
      ),
    ).toBe(true);
    expect(
      isSameDocumentReadRoute(
        { kind: 'user', documentId: 'u-1', pageIndex: 3 },
        { kind: 'user', documentId: 'u-1', pageIndex: 3 },
      ),
    ).toBe(true);
  });

  it('detects changes in section, page index, or document id', () => {
    expect(
      isSameDocumentReadRoute(
        { kind: 'official', documentId: 'esklp.mnn.risperidon', section: 'dose' },
        { kind: 'official', documentId: 'esklp.mnn.risperidon', section: 'side' },
      ),
    ).toBe(false);
    expect(
      isSameDocumentReadRoute(
        { kind: 'user', documentId: 'u-1', pageIndex: 3 },
        { kind: 'user', documentId: 'u-1', pageIndex: 4 },
      ),
    ).toBe(false);
  });
});
