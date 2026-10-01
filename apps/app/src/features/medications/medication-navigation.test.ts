import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeMedicationCatalogQuery,
  consumeMedicationProductContext,
  medicationProductFromHistory,
  openMedicationCatalogSearch,
  queueMedicationProductContext,
  rememberMedicationProduct,
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

describe('selecting a trade name inside an open document', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow(initialState: unknown): { state: unknown } {
    const history = { state: initialState };
    vi.stubGlobal('window', {
      location: { href: 'https://example.test/#/d/x', hash: '' },
      history: {
        get state() {
          return history.state;
        },
        replaceState: (state: unknown) => {
          history.state = state;
        },
      },
    });
    return history;
  }

  it('saves the selection with the history entry, keeping other state', () => {
    const history = stubWindow({ view: 'modules' });
    rememberMedicationProduct('esklp.mnn.ibuprofen', product);
    expect(history.state).toEqual({
      view: 'modules',
      medicationProduct: { documentId: 'esklp.mnn.ibuprofen', product },
    });
    expect(medicationProductFromHistory(history.state, 'esklp.mnn.ibuprofen')).toEqual(product);
  });

  it('clears the selection when the substance card is chosen', () => {
    const history = stubWindow({ view: 'modules' });
    rememberMedicationProduct('esklp.mnn.ibuprofen', product);
    rememberMedicationProduct('esklp.mnn.ibuprofen', undefined);
    expect(medicationProductFromHistory(history.state, 'esklp.mnn.ibuprofen')).toBeNull();
  });
});

describe('medication catalog search from a link', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the catalog and hands its query over once', () => {
    const location = { hash: '' };
    vi.stubGlobal('window', { location });
    openMedicationCatalogSearch('ноотропное средство');
    expect(location.hash).toBe('#/modules/documents/medications');
    expect(consumeMedicationCatalogQuery()).toBe('ноотропное средство');
    expect(consumeMedicationCatalogQuery()).toBe('');
  });
});
