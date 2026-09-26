import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { homeDocumentOrder } from '@/features/search/homeDocumentOrder';

function document(id: string, title: string, sourceType: string): MedicalDocumentSummary {
  return {
    id,
    title,
    shortTitle: null,
    sourceType,
    status: 'active',
    specialties: [],
    versionId: `${id}.v1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

describe('homeDocumentOrder', () => {
  it('lists guidelines first and moves symbol-led titles after words within a kind', () => {
    const ordered = homeDocumentOrder([
      document('chemical', '1-(4-БРОМФЕНИЛ)ВИОЛУРОВАЯ КИСЛОТА', 'official_registry_summary'),
      document('icd', 'A00 Холера, МКБ-10', 'medical_reference'),
      document('drug', 'Метформин', 'official_registry_summary'),
      document('guideline', 'Пневмония', 'clinical_recommendation'),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['guideline', 'icd', 'drug', 'chemical']);
  });
});
