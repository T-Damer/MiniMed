import { describe, expect, it } from 'vitest';

import {
  consumeMedicationProductContext,
  queueMedicationProductContext,
} from '@/features/medications/medication-navigation';
import type { MedicationProduct } from '@/features/medications/medication-record';

const product: MedicationProduct = {
  sourceKind: 'esklp',
  registrationDocumentId: 'esklp.mnn.ibuprofen',
  grlsRegistrationDocumentId: 'drug.registry.nurofen',
  instructionDocumentId: 'drug.instruction.nurofen',
  mnnDocumentId: 'esklp.mnn.ibuprofen',
  linkedMnnDocumentId: null,
  smnnCode: 'SMNN-SUSPENSION',
  smnnCodes: ['SMNN-SUSPENSION'],
  klpCodes: ['KLP-NUROFEN'],
  registrationNumber: 'ЛП-NUROFEN',
  tradeName: 'Нурофен для детей',
  inn: 'Ибупрофен',
  shortDescription: null,
  supplementalDescription: null,
  registrationStatus: 'Действует',
  prescriptionStatus: null,
  holder: null,
  manufacturer: null,
  registrationDate: null,
  pharmacotherapeuticGroups: [],
  presentations: [],
};

describe('medication product navigation context', () => {
  it('is consumed only by the exact primary document route', () => {
    expect(queueMedicationProductContext(product)).toBe('esklp.mnn.ibuprofen');
    expect(consumeMedicationProductContext('other.document')).toBeNull();
    expect(consumeMedicationProductContext('esklp.mnn.ibuprofen')).toBeNull();

    queueMedicationProductContext(product);
    expect(consumeMedicationProductContext('esklp.mnn.ibuprofen')).toBe(product);
    expect(consumeMedicationProductContext('esklp.mnn.ibuprofen')).toBeNull();
  });
});
