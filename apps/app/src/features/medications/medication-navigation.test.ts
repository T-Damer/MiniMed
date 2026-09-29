import { describe, expect, it } from 'vitest';

import {
  consumeMedicationProductContext,
  medicationProductFromHistory,
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
  presentations: [
    {
      dosageForm: 'Суспензия для приёма внутрь',
      strength: '100 мг/5 мл',
      route: null,
      packages: [{ description: 'Флакон 100 мл', prescriptionStatus: 'Без рецепта' }],
    },
  ],
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

describe('medication product restored from history state', () => {
  // A reload keeps history.state but drops the in-memory catalog handoff.
  const saved = JSON.parse(
    JSON.stringify({
      view: 'modules',
      medicationProduct: { documentId: 'esklp.mnn.ibuprofen', product },
    }),
  ) as unknown;

  it('returns the product saved for the same document entry', () => {
    expect(medicationProductFromHistory(saved, 'esklp.mnn.ibuprofen')).toEqual(product);
  });

  it('ignores a product saved for another document', () => {
    expect(medicationProductFromHistory(saved, 'esklp.mnn.paracetamol')).toBeNull();
  });

  it('rejects missing or malformed saved state', () => {
    expect(medicationProductFromHistory(null, 'esklp.mnn.ibuprofen')).toBeNull();
    expect(medicationProductFromHistory({ view: 'modules' }, 'esklp.mnn.ibuprofen')).toBeNull();
    const malformed = {
      medicationProduct: {
        documentId: 'esklp.mnn.ibuprofen',
        product: { ...product, presentations: [{ dosageForm: 1 }] },
      },
    };
    expect(medicationProductFromHistory(malformed, 'esklp.mnn.ibuprofen')).toBeNull();
  });
});
