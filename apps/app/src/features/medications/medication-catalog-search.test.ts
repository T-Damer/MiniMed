import { describe, expect, it } from 'vitest';

import {
  medicationCatalogMatchScore,
  rankMedicationCatalog,
} from '@/features/medications/medication-catalog-search';
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

  describe('by ATC code', () => {
    // ЕСКЛП gives umifenovir only the group stub L03AX; the sources agree on J05AX13 (ATC3).
    const arbidol = product('Арбидол', 'умифеновир', { atcCodes: ['L03AX', 'J05AX13'] });
    const other = product('Нурофен', 'ибупрофен', { atcCodes: ['M01AE01'] });
    const noCodes = product('Аква', 'вода');
    const products = [other, arbidol, noCodes];

    it('finds the drug under the registry code and under the consensus code', () => {
      expect(rankMedicationCatalog(products, 'L03AX')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'J05AX13')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'j05ax13')).toEqual([arbidol]);
    });

    it('matches a group prefix and a code typed with Cyrillic look-alikes', () => {
      expect(rankMedicationCatalog(products, 'J05')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'М01АЕ')).toEqual([other]);
    });

    it('reads a code typed up to its last digit, with spaces, or with the Russian layout (ATC5)', () => {
      expect(rankMedicationCatalog(products, 'J05AX1')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'j05 ax 13')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'о05')).toEqual([arbidol]);
      expect(rankMedicationCatalog(products, 'ь01')).toEqual([other]);
    });

    it('does not read a short word as a code, and ignores products without codes', () => {
      expect(rankMedicationCatalog(products, 'J')).toEqual([]);
      expect(rankMedicationCatalog(products, 'N02')).toEqual([]);
      expect(medicationCatalogMatchScore(noCodes, 'J05AX13')).toBe(0);
      expect(medicationCatalogMatchScore(arbidol, 'J05AX13')).toBeGreaterThan(0);
    });
  });
});
