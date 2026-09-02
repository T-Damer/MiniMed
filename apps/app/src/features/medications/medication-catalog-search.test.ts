import { describe, expect, it } from 'vitest';

import { rankMedicationCatalog } from '@/features/medications/medication-catalog-search';
import type { MedicationProduct } from '@/features/medications/medication-record';

function product(
  tradeName: string,
  inn: string,
  extra: Partial<MedicationProduct> = {},
): MedicationProduct {
  return {
    sourceKind: 'allmed',
    registrationDocumentId: tradeName,
    grlsRegistrationDocumentId: null,
    instructionDocumentId: null,
    mnnDocumentId: null,
    linkedMnnDocumentId: null,
    smnnCode: null,
    smnnCodes: [],
    klpCodes: [],
    registrationNumber: tradeName,
    tradeName,
    inn,
    shortDescription: null,
    supplementalDescription: null,
    registrationStatus: 'Действующий',
    prescriptionStatus: null,
    holder: null,
    manufacturer: null,
    registrationDate: null,
    pharmacotherapeuticGroups: [],
    presentations: [],
    ...extra,
  };
}

describe('rankMedicationCatalog', () => {
  it('keeps the original order when the query is empty', () => {
    const products = [product('Колдрекс', 'парацетамол'), product('Парацетамол', 'парацетамол')];
    expect(rankMedicationCatalog(products, ' ').map((item) => item.tradeName)).toEqual([
      'Колдрекс',
      'Парацетамол',
    ]);
  });

  it('ranks the dedicated trade name above a combination that contains the same INN', () => {
    const ranked = rankMedicationCatalog(
      [
        product('Колдрекс ХотРем', 'парацетамол фенирамин фенилэфрин'),
        product('Антигриппин', 'парацетамол'),
        product('Парацетамол', 'парацетамол'),
        product('Парацетамол + римантадин', 'парацетамол римантадин'),
      ],
      'Парацетамол',
    );

    expect(ranked.map((item) => item.tradeName)).toEqual([
      'Парацетамол',
      'Парацетамол + римантадин',
      'Антигриппин',
      'Колдрекс ХотРем',
    ]);
  });

  it('prefers a trade-name prefix over a fuzzy match elsewhere', () => {
    const ranked = rankMedicationCatalog(
      [
        product('Натрия пара-аминосалицилат', 'натрия пара-аминосалицилат'),
        product('Парацетамол + римантадин', 'парацетамол римантадин'),
        product('Парацетамол', 'парацетамол'),
      ],
      'Парацетам',
    );

    expect(ranked.map((item) => item.tradeName)).toEqual([
      'Парацетамол',
      'Парацетамол + римантадин',
      'Натрия пара-аминосалицилат',
    ]);
  });

  it('ranks the matching suspension variant above tablets', () => {
    const ranked = rankMedicationCatalog(
      [
        product('Нурофен', 'Ибупрофен', {
          registrationDocumentId: 'mnn.ibuprofen',
          mnnDocumentId: 'mnn.ibuprofen',
          smnnCode: 'smnn.tablet',
          presentations: [
            {
              dosageForm: 'Таблетки',
              strength: '200 мг',
              route: null,
              packages: [{ description: '12 таблеток', prescriptionStatus: null }],
            },
          ],
        }),
        product('Нурофен для детей', 'Ибупрофен', {
          registrationDocumentId: 'mnn.ibuprofen',
          mnnDocumentId: 'mnn.ibuprofen',
          smnnCode: 'smnn.suspension',
          presentations: [
            {
              dosageForm: 'Суспензия для приема внутрь',
              strength: '100 мг/5 мл',
              route: 'Внутрь',
              packages: [{ description: 'Флакон 100 мл', prescriptionStatus: null }],
            },
          ],
        }),
      ],
      'Нурофен суспензия',
    );

    expect(ranked.map((item) => item.tradeName)).toEqual(['Нурофен для детей']);
  });

  it('treats syrup wording and a common typo as formulation search aliases', () => {
    const suspension = product('Нурофен для детей', 'Ибупрофен', {
      presentations: [
        {
          dosageForm: 'Суспензия для приема внутрь',
          strength: '100 мг/5 мл',
          route: null,
          packages: [],
        },
      ],
    });

    expect(rankMedicationCatalog([suspension], 'Нурофен сироп')).toEqual([suspension]);
    expect(rankMedicationCatalog([suspension], 'Нурофен спироп')).toEqual([suspension]);
  });
});
