import { describe, expect, it } from 'vitest';

import { canonicalDocumentId, isSameDocumentIdentity } from '@/state/document-identity';

const CLINICAL_POINTER = 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac';
const MEDICATION_POINTER = 'core.catalog.pointer.medication.esklp.mnn.албендазол-062d3e89c1c0b8dd';
const REFERENCE_POINTER = 'core.catalog.pointer.reference.rls.mkb.node.p52-1-44f76941c6e96f91';

describe('canonicalDocumentId', () => {
  it('maps a pointer to the id of the document it leads to', () => {
    expect(canonicalDocumentId(CLINICAL_POINTER)).toBe('kr.rf.1006_1');
    expect(canonicalDocumentId(MEDICATION_POINTER)).toBe('esklp.mnn.албендазол');
    expect(canonicalDocumentId(REFERENCE_POINTER)).toBe('rls.mkb.node.p52-1');
  });

  it('leaves an ordinary document id alone', () => {
    expect(canonicalDocumentId('kr.rf.1006_1')).toBe('kr.rf.1006_1');
    expect(canonicalDocumentId('user-doc-1')).toBe('user-doc-1');
  });
});

describe('isSameDocumentIdentity', () => {
  it('treats a pointer and its installed document as one document', () => {
    expect(isSameDocumentIdentity(CLINICAL_POINTER, 'kr.rf.1006_1')).toBe(true);
    expect(isSameDocumentIdentity('esklp.mnn.албендазол', MEDICATION_POINTER)).toBe(true);
  });

  it('keeps the family rules: a summary, its full text and a topic card of one recommendation', () => {
    expect(isSameDocumentIdentity('kr.rf.281_3', 'kr.rf.281_3.full')).toBe(true);
    expect(isSameDocumentIdentity(CLINICAL_POINTER, 'kr.rf.1006_1.full')).toBe(true);
  });

  it('keeps different documents apart', () => {
    expect(isSameDocumentIdentity(CLINICAL_POINTER, 'kr.rf.1007_1')).toBe(false);
    expect(isSameDocumentIdentity(MEDICATION_POINTER, 'esklp.mnn.празиквантел')).toBe(false);
  });
});
