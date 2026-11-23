import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  extractEsklpRegistrationNumbers,
  selectSubstanceInstruction,
} from '@/features/medications/installed-substance-reader';
import { parseEsklpMedicationProducts } from '@/features/medications/medication-record';

function esklpDocument(): MedicalDocument {
  return {
    id: 'esklp.mnn.рисперидон',
    title: 'Рисперидон',
    shortTitle: 'Рисперидон',
    sourceType: 'medication_reference',
    status: 'active',
    specialties: ['psychiatry'],
    versionId: 'esklp.mnn.рисперидон:v1',
    versionLabel: '2026-08-28',
    effectiveFrom: null,
    sourceChecksum: 'abc',
    metadata: {
      contentMode: 'esklp-mnn',
      standardizedInn: 'РИСПЕРИДОН',
      inn: ['РИСПЕРИДОН'],
      smnnNodes: [
        {
          smnnCode: 'SMNN-1',
          dosageForm: 'ТАБЛЕТКИ, ПОКРЫТЫЕ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ',
          strength: '2 мг',
          tradeNames: [
            {
              tradeName: 'РИСПОЛЕПТ',
              registrationNumber: 'П N013726/01',
              dosageForm: 'ТАБЛЕТКИ',
            },
            {
              tradeName: 'РИСПЕРИДОН',
              registrationNumber: 'ЛП-001234',
            },
            {
              // Duplicate registration across variants should appear once.
              tradeName: 'РИСПЕРИДОН',
              registrationNumber: 'ЛП-001234',
              dosageForm: 'ТАБЛЕТКИ',
            },
            {
              // Missing tradeName is skipped by parseEsklpMedicationProducts too.
              registrationNumber: 'ЛП-999999',
            },
          ],
          klpPositions: [
            {
              tradeName: 'РИСПЕРИДОН',
              registrationNumber: 'ЛП-ONLY-KLP',
              dosageForm: 'ТАБЛЕТКИ',
            },
          ],
        },
        {
          // Node without smnnCode is ignored.
          dosageForm: 'ТАБЛЕТКИ',
          tradeNames: [{ tradeName: 'NO-SMNN', registrationNumber: 'ЛП-000000' }],
        },
      ],
    },
    sections: [],
  };
}

describe('installed-substance-reader helpers', () => {
  it('extracts the exact same unique registration numbers as parseEsklpMedicationProducts', () => {
    const source = esklpDocument();
    const expected = [
      ...new Set(parseEsklpMedicationProducts(source).map((product) => product.registrationNumber)),
    ];
    expect(extractEsklpRegistrationNumbers(source)).toEqual(expected);
    expect(extractEsklpRegistrationNumbers(source)).toEqual(['П N013726/01', 'ЛП-001234']);
  });

  it('returns an empty list for non-esklp documents', () => {
    const nonEsklp = { ...esklpDocument(), metadata: { contentMode: 'other' } };
    expect(extractEsklpRegistrationNumbers(nonEsklp)).toEqual([]);
  });

  it('selects the whole native-text instruction with precomputed readability', () => {
    const source = esklpDocument();
    const listed = [
      {
        id: 'instr.scan',
        sourceType: 'official_drug_instruction' as const,
        metadata: {
          registrationNumber: 'П N013726/01',
          extractionMethod: 'ocr',
        },
      },
      {
        id: 'instr.native',
        sourceType: 'official_drug_instruction' as const,
        metadata: {
          registrationNumber: 'ЛП-001234',
          extractionMethod: 'native',
        },
      },
    ];
    const selected = selectSubstanceInstruction(source, listed);
    expect(selected?.instructionDocumentId).toBe('instr.native');
    expect(selected?.registrationNumber).toBe('ЛП-001234');
  });
});
