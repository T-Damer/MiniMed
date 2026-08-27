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
    instructionDocumentId: null,
    registrationNumber: tradeName,
    tradeName,
    inn,
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
});
