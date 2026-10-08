import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { distinctNavigationDocuments } from '@/features/search/navigation-documents';

function document(id: string, metadata?: Record<string, unknown>): MedicalDocumentSummary {
  return {
    id,
    title: id,
    sourceType: 'clinical_recommendation',
    metadata,
  } as MedicalDocumentSummary;
}

function pointer(id: string, targetDocumentId: string): MedicalDocumentSummary {
  return document(id, {
    contentMode: 'module-pointer',
    targetDocumentId,
    primaryModuleId: 'module-a',
    moduleIds: ['module-a'],
  });
}

describe('distinctNavigationDocuments', () => {
  it('lists a document once however many installed modules carry it', () => {
    const list = [document('kr.1'), document('kr.1'), document('kr.2')];
    expect(distinctNavigationDocuments(list).map((entry) => entry.id)).toEqual(['kr.1', 'kr.2']);
  });

  it('lets an installed document replace the pointer that stood for it', () => {
    const list = [pointer('pointer.1', 'kr.1'), pointer('pointer.2', 'kr.2'), document('kr.1')];
    expect(distinctNavigationDocuments(list).map((entry) => entry.id)).toEqual([
      'pointer.2',
      'kr.1',
    ]);
  });

  it('keeps pointers whose module is not installed', () => {
    const list = [pointer('pointer.1', 'kr.1')];
    expect(distinctNavigationDocuments(list)).toEqual(list);
  });
});
