import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import type { MedicationProduct } from '@/features/medications/medication-record';
import {
  registrationRows,
  representativeInstructionProduct,
  withoutRegistrySections,
} from './substance-reading';

function product(overrides: Partial<MedicationProduct>): MedicationProduct {
  return {
    sourceKind: 'esklp',
    registrationDocumentId: 'esklp.mnn.пропранолол',
    grlsRegistrationDocumentId: null,
    instructionDocumentId: null,
    mnnDocumentId: 'esklp.mnn.пропранолол',
    linkedMnnDocumentId: null,
    smnnCode: null,
    smnnCodes: [],
    klpCodes: [],
    registrationNumber: 'ЛС-000001',
    tradeName: 'Анаприлин',
    inn: 'ПРОПРАНОЛОЛ',
    shortDescription: null,
    supplementalDescription: null,
    registrationStatus: 'active',
    prescriptionStatus: null,
    holder: 'АО ТАТХИМФАРМПРЕПАРАТЫ',
    manufacturer: null,
    registrationDate: null,
    pharmacotherapeuticGroups: [],
    presentations: [
      { dosageForm: 'ТАБЛЕТКИ', strength: '10.0мг', route: null, packages: [] },
      { dosageForm: 'ТАБЛЕТКИ', strength: '40.0 мг', route: null, packages: [] },
    ],
    ...overrides,
  };
}

const section = (title: string) =>
  ({
    id: title,
    title,
    anchor: title,
    depth: 1,
    chunks: [],
  }) as unknown as MedicalDocument['sections'][number];

describe('the body of a drug card', () => {
  it('drops the ЕСКЛП registry sections (owner 2026-10-20: 144 screens of packages)', () => {
    const card = {
      id: 'esklp.mnn.пропранолол',
      metadata: { contentMode: 'esklp-mnn' },
      sections: [
        section('Сведения о стандартизированном МНН'),
        section('Формы и дозировки'),
        section('Торговые наименования'),
        section('Ограничения данных'),
      ],
    } as unknown as MedicalDocument;
    expect(withoutRegistrySections(card).sections.map((item) => item.title)).toEqual([]);
    const instruction = { ...card, metadata: {} } as unknown as MedicalDocument;
    expect(withoutRegistrySections(instruction)).toBe(instruction);
  });

  it('reads the official instruction of the most fitting trade name', () => {
    const fallback = product({
      registrationNumber: 'ЛП-1',
      instructionDocumentId: 'other',
      instructionFallback: { registrationNumber: 'ЛП-9' } as NonNullable<
        MedicationProduct['instructionFallback']
      >,
    });
    const site = product({
      registrationNumber: 'ЛП-2',
      instructionDocumentId: 'site',
      instructionSourceClass: 'manufacturer-site',
    });
    const brand = product({ registrationNumber: 'ЛП-3', instructionDocumentId: 'brand' });
    const generic = product({
      registrationNumber: 'ЛП-4',
      tradeName: 'ПРОПРАНОЛОЛ',
      instructionDocumentId: 'generic',
    });
    const none = product({ registrationNumber: 'ЛП-5' });
    expect(
      representativeInstructionProduct([none, fallback, site, brand, generic], 'Пропранолол')
        ?.instructionDocumentId,
    ).toBe('generic');
    expect(
      representativeInstructionProduct([fallback, site, brand], 'Пропранолол')
        ?.instructionDocumentId,
    ).toBe('brand');
    expect(
      representativeInstructionProduct([fallback, site], 'Пропранолол')?.instructionDocumentId,
    ).toBe('site');
    expect(representativeInstructionProduct([none], 'Пропранолол')).toBeNull();
    // Ибупрофен: the adult tablets, not the children's suppositories of the same name.
    const suppositories = product({
      registrationNumber: 'ЛП-6',
      tradeName: 'Ибупрофен',
      instructionDocumentId: 'suppositories',
      presentations: [
        {
          dosageForm: 'СУППОЗИТОРИИ РЕКТАЛЬНЫЕ (ДЛЯ ДЕТЕЙ)',
          strength: '60 мг',
          route: null,
          packages: [],
        },
      ],
    });
    const tablets = product({
      registrationNumber: 'ЛП-7',
      tradeName: 'Нурофен',
      instructionDocumentId: 'tablets',
      presentations: [
        {
          dosageForm: 'ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ',
          strength: '200 мг',
          route: null,
          packages: [],
        },
      ],
    });
    expect(
      representativeInstructionProduct([suppositories, tablets], 'Ибупрофен')
        ?.instructionDocumentId,
    ).toBe('tablets');
  });

  it('lists registrations once each, without packages', () => {
    const rows = registrationRows([
      product({ registrationNumber: 'ЛС-002037', tradeName: 'АНАПРИЛИН РЕНЕВАЛ' }),
      product({ registrationNumber: 'ЛС-002037', tradeName: 'АНАПРИЛИН РЕНЕВАЛ' }),
      product({
        registrationNumber: 'ЛП-003301',
        tradeName: 'Гемангиол',
        holder: 'ПЬЕР ФАБР ДЕРМАТОЛОГИЯ',
        presentations: [
          {
            dosageForm: 'РАСТВОР ДЛЯ ПРИЕМА ВНУТРЬ',
            strength: '3.75мг/мл',
            route: null,
            packages: [],
          },
        ],
      }),
    ]);
    expect(rows.map((row) => [row.name, row.forms, row.registrationNumber])).toEqual([
      ['Анаприлин реневал', 'таблетки 10мг, 40 мг', 'ЛС-002037'],
      ['Гемангиол', 'раствор для приема внутрь 3.75мг/мл', 'ЛП-003301'],
    ]);
  });
});
