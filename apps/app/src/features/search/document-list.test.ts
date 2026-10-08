import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { sameDocumentList } from '@/features/search/document-list';

function document(id: string, versionId = `${id}@1`): MedicalDocumentSummary {
  return {
    id,
    title: id,
    shortTitle: null,
    sourceType: 'clinical_recommendation',
    status: 'current',
    specialties: [],
    versionId,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

describe('sameDocumentList', () => {
  it('treats an identical reread as unchanged', () => {
    expect(sameDocumentList([document('a'), document('b')], [document('a'), document('b')])).toBe(
      true,
    );
  });

  it('sees an added, removed or re-versioned document', () => {
    const current = [document('a'), document('b')];
    expect(sameDocumentList(current, [document('a')])).toBe(false);
    expect(sameDocumentList(current, [document('a'), document('b'), document('c')])).toBe(false);
    expect(sameDocumentList(current, [document('a'), document('b', 'b@2')])).toBe(false);
  });
});
