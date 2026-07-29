import { describe, expect, it } from 'vitest';

import { parseMedicationProduct } from './medication-record';

describe('parseMedicationProduct', () => {
  it('keeps every package variant from a normalized registry document', () => {
    const product = parseMedicationProduct(
      {
        id: 'drug.registry',
        title: 'Мирамистин',
        shortTitle: 'Мирамистин',
        sourceType: 'official_registry_summary',
        status: 'active',
        specialties: [],
        versionId: 'drug.registry@1',
        versionLabel: '1',
        effectiveFrom: null,
        sections: [],
        metadata: {
          contentMode: 'registry-normalized',
          registrationNumber: 'ЛП-1',
          tradeName: 'Мирамистин®',
          inn: 'Действующее вещество',
          registrationStatus: 'Действующий',
          presentations: [
            {
              dosageForm: 'раствор',
              strength: '0.01%',
              packages: [
                { description: '50 мл', prescriptionStatus: 'Без рецепта' },
                { description: '150 мл', prescriptionStatus: 'Без рецепта' },
              ],
            },
          ],
        },
      },
      'drug.instruction',
    );

    expect(product?.presentations[0]?.packages.map((item) => item.description)).toEqual([
      '50 мл',
      '150 мл',
    ]);
    expect(product?.instructionDocumentId).toBe('drug.instruction');
  });
});
