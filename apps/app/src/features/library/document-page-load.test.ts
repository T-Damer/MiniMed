import { describe, expect, it } from 'vitest';

import { shouldReloadOfficialDocument } from '@/features/library/document-page-load';

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
