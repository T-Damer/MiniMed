import { describe, expect, it } from 'vitest';

import { allmedMatchesProduct, dosageFormClasses, dosageFormsCompatible } from './allmed-matching';
import type { MedicationProduct } from './medication-record';

function product(overrides: Partial<MedicationProduct>): MedicationProduct {
  return {
    sourceKind: 'esklp',
    registrationDocumentId: 'esklp.mnn.ibuprofen',
    grlsRegistrationDocumentId: null,
    instructionDocumentId: null,
    mnnDocumentId: 'esklp.mnn.ibuprofen',
    linkedMnnDocumentId: null,
    smnnCode: null,
    smnnCodes: [],
    klpCodes: [],
    registrationNumber: 'ЛП-1',
    tradeName: 'Нурофен',
    inn: 'Ибупрофен',
    shortDescription: null,
    supplementalDescription: null,
    registrationStatus: 'Действующий',
    prescriptionStatus: null,
    holder: null,
    manufacturer: null,
    registrationDate: null,
    pharmacotherapeuticGroups: [],
    presentations: [
      { dosageForm: 'ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ', strength: null, route: null, packages: [] },
    ],
    ...overrides,
  };
}

function allmed(overrides: Partial<MedicationProduct>): MedicationProduct {
  return product({
    sourceKind: 'allmed',
    mnnDocumentId: null,
    linkedMnnDocumentId: 'esklp.mnn.ibuprofen',
    registrationNumber: 'allmed:7',
    shortDescription: 'НПВС.',
    ...overrides,
  });
}

function forms(text: string): string[] {
  return [...dosageFormClasses(text)].sort();
}

describe('dosageFormClasses', () => {
  it('reads registry and Allmed spellings', () => {
    expect(forms('ТАБЛЕТКИ ПОКРЫТЫЕ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ')).toEqual(['oral-solid']);
    expect(forms('Табл. 200 мг: 10 шт.')).toEqual(['oral-solid']);
    expect(forms('СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ')).toEqual(['oral-liquid']);
    expect(forms('РАСТВОР ДЛЯ ИНЪЕКЦИЙ')).toEqual(['injection']);
    expect(forms('Р-р д/инъекц. 50% (1 г/2 мл): амп. 10 шт.\n\nТаблетки белого цвета')).toEqual([
      'injection',
      'oral-solid',
    ]);
    expect(forms('КАПЛИ ГЛАЗНЫЕ')).toEqual(['eye']);
    expect(forms('МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ')).toEqual(['topical']);
    expect(forms('СУППОЗИТОРИИ РЕКТАЛЬНЫЕ')).toEqual(['rectal']);
  });

  it('names nothing for an empty or unknown form', () => {
    expect(forms('')).toEqual([]);
    expect(forms('Не указана')).toEqual([]);
    expect(dosageFormClasses(null).size).toBe(0);
  });
});

describe('dosageFormsCompatible', () => {
  it('rules an entry out only when both sides name forms with nothing in common', () => {
    const tablet = product({});
    expect(
      dosageFormsCompatible(
        tablet,
        allmed({
          presentations: [
            {
              dosageForm: 'Суспензия для приема внутрь',
              strength: null,
              route: null,
              packages: [],
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      dosageFormsCompatible(
        tablet,
        allmed({
          presentations: [
            { dosageForm: 'Табл. 200 мг', strength: null, route: null, packages: [] },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      dosageFormsCompatible(
        tablet,
        allmed({
          presentations: [{ dosageForm: 'Не указана', strength: null, route: null, packages: [] }],
        }),
      ),
    ).toBe(true);
  });
});

describe('allmedMatchesProduct', () => {
  it('matches the same substance, trade name and a compatible form', () => {
    expect(allmedMatchesProduct(product({}), allmed({ tradeName: 'нурофен®' }))).toBe(true);
  });

  it('never matches across substances', () => {
    expect(
      allmedMatchesProduct(product({}), allmed({ linkedMnnDocumentId: 'esklp.mnn.paracetamol' })),
    ).toBe(false);
    expect(allmedMatchesProduct(product({}), allmed({ linkedMnnDocumentId: null }))).toBe(false);
    expect(allmedMatchesProduct(product({ mnnDocumentId: null }), allmed({}))).toBe(false);
  });

  it('never matches another trade name of the same substance', () => {
    expect(allmedMatchesProduct(product({}), allmed({ tradeName: 'Ибуклин' }))).toBe(false);
  });

  it('does not attach a syrup entry to a tablet product', () => {
    expect(
      allmedMatchesProduct(
        product({}),
        allmed({
          presentations: [
            {
              dosageForm: 'Сироп 100 мг/5 мл: фл. 100 мл',
              strength: null,
              route: null,
              packages: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('only matches Allmed entries', () => {
    expect(
      allmedMatchesProduct(product({}), product({ linkedMnnDocumentId: 'esklp.mnn.ibuprofen' })),
    ).toBe(false);
  });
});
