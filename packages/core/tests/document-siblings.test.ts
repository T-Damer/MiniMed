import { describe, expect, it } from 'vitest';

import {
  fullDocumentCandidateId,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
} from '../src/document-siblings';

describe('document-siblings', () => {
  it('prefers installed full-text siblings when opening documents', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia', available)).toBe(
      'kr.rf.714_2.pneumonia.full',
    );
    expect(fullDocumentCandidateId('kr.rf.714_2.pneumonia')).toBe('kr.rf.714_2.pneumonia.full');
    expect(isSupersededSummaryDocument('kr.rf.714_2.pneumonia', available)).toBe(true);
    expect(isSupersededSummaryDocument('kr.rf.714_2.pneumonia.full', available)).toBe(false);
  });
});
