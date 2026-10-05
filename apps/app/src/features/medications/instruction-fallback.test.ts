import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  applyInstructionFallbacks,
  EMPTY_SUBSTANCE_FALLBACK,
  FALLBACK_FLAG_FORM_DIFFERS,
  FALLBACK_FLAG_STRENGTH_DIFFERS,
  FALLBACK_FLAG_STRENGTH_UNKNOWN,
  FALLBACK_LABEL,
  FALLBACK_LABEL_WITH_DIFFERENCES,
  fallbackNotice,
  fallbackWarnings,
  parseSubstanceFallbackAsset,
  productWithInstructionFallback,
  resolveInstructionFallback,
  type SubstanceFallbackAsset,
  sameInstructionSlot,
} from './instruction-fallback';
import { type MedicationProduct, parseEsklpMedicationProducts } from './medication-record';

function card(
  id: string,
  nodes: readonly {
    readonly code: string;
    readonly form: string;
    readonly strength: string;
    readonly trades: readonly (readonly [name: string, registration: string])[];
  }[],
): MedicalDocument {
  return {
    id,
    title: id,
    shortTitle: null,
    sourceType: 'official_registry_summary',
    status: 'active',
    specialties: [],
    versionId: 'v1',
    versionLabel: '2026-08-28',
    effectiveFrom: null,
    sections: [],
    metadata: {
      contentMode: 'esklp-mnn',
      standardizedInn: 'ИБУПРОФЕН',
      smnnNodes: nodes.map((node) => ({
        smnnCode: node.code,
        dosageForm: node.form,
        strength: node.strength,
        tradeNames: node.trades.map(([tradeName, registrationNumber]) => ({
          tradeName,
          registrationNumber,
          dosageForm: node.form,
          strength: node.strength,
        })),
        klpPositions: [],
      })),
    },
  };
}

function asset(
  groups: ReadonlyArray<{ level: 1 | 2; donors: ReadonlyArray<readonly [string, number]> }>,
  registrations: Readonly<Record<string, number>>,
): SubstanceFallbackAsset {
  return parseSubstanceFallbackAsset({
    schemaVersion: 1,
    basis: { esklpEdition: '2026-08-28', grlsRegistryEdition: '02.10.2026' },
    groups: groups.map((group) => ({
      level: group.level,
      donors: group.donors.map(([number, flags]) => [number, flags]),
    })),
    registrations,
  });
}

const CARD = card('esklp.mnn.ибупрофен', [
  {
    code: 'n200',
    form: 'ТАБЛЕТКИ',
    strength: '200.0мг',
    trades: [
      ['Нурофен', 'R-DONOR'],
      ['Ибупрофен Д', 'R-TARGET'],
    ],
  },
  {
    code: 'n400',
    form: 'ТАБЛЕТКИ',
    strength: '400.0мг',
    trades: [['Ибупрофен 400', 'R-OTHER-STRENGTH']],
  },
]);

function productOf(registration: string, document: MedicalDocument = CARD): MedicationProduct {
  const found = parseEsklpMedicationProducts(document).find(
    (item) => item.registrationNumber === registration,
  );
  if (!found) throw new Error(`no product ${registration}`);
  return found;
}

describe('parseSubstanceFallbackAsset', () => {
  it('reads groups once and points registrations at them', () => {
    const parsed = asset([{ level: 1, donors: [['R-DONOR', 0]] }], { 'R-TARGET': 0 });
    expect(parsed.registrations.get('R-TARGET')).toEqual({
      level: 1,
      donors: [{ registrationNumber: 'R-DONOR', flags: 0 }],
    });
    expect(parsed.esklpEdition).toBe('2026-08-28');
  });

  it.each([
    ['not an object', 'x'],
    ['unsupported version', { schemaVersion: 2, basis: {}, groups: [], registrations: {} }],
    ['no basis', { schemaVersion: 1, groups: [], registrations: {} }],
    ['unknown group', { schemaVersion: 1, basis: {}, groups: [], registrations: { 'R-1': 0 } }],
    [
      'level 1 with a difference',
      {
        schemaVersion: 1,
        basis: {},
        groups: [{ level: 1, donors: [['R-2', 1]] }],
        registrations: { 'R-1': 0 },
      },
    ],
    [
      'level 2 without a difference',
      {
        schemaVersion: 1,
        basis: {},
        groups: [{ level: 2, donors: [['R-2', 0]] }],
        registrations: { 'R-1': 0 },
      },
    ],
    [
      'bad flags',
      {
        schemaVersion: 1,
        basis: {},
        groups: [{ level: 2, donors: [['R-2', 9]] }],
        registrations: { 'R-1': 0 },
      },
    ],
    [
      'empty donors',
      {
        schemaVersion: 1,
        basis: {},
        groups: [{ level: 1, donors: [] }],
        registrations: { 'R-1': 0 },
      },
    ],
  ])('rejects a malformed asset: %s', (_name, value) => {
    expect(() => parseSubstanceFallbackAsset(value)).toThrow(/Substance fallback/u);
  });

  it('accepts the real generated asset', async () => {
    const real = await import('./substance-fallback.json');
    const parsed = parseSubstanceFallbackAsset(real.default);
    expect(parsed.registrations.size).toBeGreaterThan(1000);
  });
});

describe('resolveInstructionFallback', () => {
  const target = productOf('R-TARGET');
  const cardProducts = parseEsklpMedicationProducts(CARD);
  const fallbackAsset = asset([{ level: 1, donors: [['R-DONOR', 0]] }], { 'R-TARGET': 0 });

  it('points a product without a text at the donor document and names the donor', () => {
    const found = resolveInstructionFallback({
      product: target,
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: new Map([['R-DONOR', 'grls.doc.1']]),
    });
    expect(found?.documentId).toBe('grls.doc.1');
    expect(found?.source).toMatchObject({
      level: 1,
      flags: 0,
      registrationNumber: 'R-DONOR',
      tradeName: 'Нурофен',
      dosageForm: 'ТАБЛЕТКИ',
    });
  });

  it('applies nothing while the donor document is not installed', () => {
    expect(
      resolveInstructionFallback({
        product: target,
        cardProducts,
        asset: fallbackAsset,
        instructionIndex: new Map(),
      }),
    ).toBeNull();
  });

  it('never gives a fallback to a product with a text of its own', () => {
    const own: MedicationProduct = { ...target, instructionDocumentId: 'grls.doc.own' };
    expect(
      resolveInstructionFallback({
        product: own,
        cardProducts,
        asset: fallbackAsset,
        instructionIndex: new Map([['R-DONOR', 'grls.doc.1']]),
      }),
    ).toBeNull();
  });

  it('never takes a donor from another МНН card, even when the asset lists it', () => {
    const other = card('esklp.mnn.парацетамол', [
      { code: 'p500', form: 'ТАБЛЕТКИ', strength: '500.0мг', trades: [['Панадол', 'R-DONOR']] },
    ]);
    const mixed = [
      ...cardProducts.filter((item) => item.registrationNumber !== 'R-DONOR'),
      ...parseEsklpMedicationProducts(other),
    ];
    expect(
      resolveInstructionFallback({
        product: target,
        cardProducts: mixed,
        asset: fallbackAsset,
        instructionIndex: new Map([['R-DONOR', 'grls.doc.1']]),
      }),
    ).toBeNull();
  });

  it('walks the ranked donors until one has an installed document', () => {
    const ranked = asset(
      [
        {
          level: 2,
          donors: [
            ['R-MISSING', 1],
            ['R-OTHER-STRENGTH', FALLBACK_FLAG_STRENGTH_DIFFERS],
          ],
        },
      ],
      { 'R-TARGET': 0 },
    );
    const found = resolveInstructionFallback({
      product: target,
      cardProducts,
      asset: ranked,
      instructionIndex: new Map([['R-OTHER-STRENGTH', 'grls.doc.2']]),
    });
    expect(found?.documentId).toBe('grls.doc.2');
    expect(found?.source.level).toBe(2);
    expect(found?.source.flags).toBe(FALLBACK_FLAG_STRENGTH_DIFFERS);
    expect(found?.source.strength).toBe('400.0мг');
  });

  it('is not applied to a product that is not an ЕСКЛП registration', () => {
    const allmed: MedicationProduct = { ...target, sourceKind: 'allmed' };
    expect(
      resolveInstructionFallback({
        product: allmed,
        cardProducts,
        asset: fallbackAsset,
        instructionIndex: new Map([['R-DONOR', 'grls.doc.1']]),
      }),
    ).toBeNull();
  });
});

describe('productWithInstructionFallback / applyInstructionFallbacks', () => {
  const cardProducts = parseEsklpMedicationProducts(CARD);
  const fallbackAsset = asset([{ level: 1, donors: [['R-DONOR', 0]] }], { 'R-TARGET': 0 });
  const index = new Map([['R-DONOR', 'grls.doc.1']]);

  it('sets the donor document and the provenance next to it', () => {
    const resolved = productWithInstructionFallback({
      product: productOf('R-TARGET'),
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: index,
    });
    expect(resolved.instructionDocumentId).toBe('grls.doc.1');
    expect(resolved.instructionFallback?.registrationNumber).toBe('R-DONOR');
  });

  it('leaves a product with its own text untouched and applies nothing to the donor itself', () => {
    const products = applyInstructionFallbacks(
      parseEsklpMedicationProducts(CARD, index),
      fallbackAsset,
      index,
    );
    const donor = products.find((item) => item.registrationNumber === 'R-DONOR');
    expect(donor?.instructionDocumentId).toBe('grls.doc.1');
    expect(donor?.instructionFallback).toBeUndefined();
    const target = products.find((item) => item.registrationNumber === 'R-TARGET');
    expect(target?.instructionFallback?.registrationNumber).toBe('R-DONOR');
    const unlisted = products.find((item) => item.registrationNumber === 'R-OTHER-STRENGTH');
    expect(unlisted?.instructionDocumentId).toBeNull();
    expect(unlisted?.instructionFallback).toBeUndefined();
  });

  it('drops a fallback restored from history when its donor is no longer installed', () => {
    const stale = productWithInstructionFallback({
      product: productOf('R-TARGET'),
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: index,
    });
    const refreshed = productWithInstructionFallback({
      product: stale,
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: new Map(),
    });
    expect(refreshed.instructionDocumentId).toBeNull();
    expect(refreshed.instructionFallback).toBeUndefined();
  });

  it('replaces a restored fallback by the own text once that has arrived', () => {
    const stale = productWithInstructionFallback({
      product: productOf('R-TARGET'),
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: index,
    });
    const refreshed = productWithInstructionFallback({
      product: stale,
      cardProducts,
      asset: fallbackAsset,
      instructionIndex: new Map([
        ['R-DONOR', 'grls.doc.1'],
        ['R-TARGET', 'grls.doc.own'],
      ]),
    });
    expect(refreshed.instructionDocumentId).toBe('grls.doc.own');
    expect(refreshed.instructionFallback).toBeUndefined();
  });

  it('does nothing with the empty asset', () => {
    const product = productOf('R-TARGET');
    const resolved = productWithInstructionFallback({
      product,
      cardProducts,
      asset: EMPTY_SUBSTANCE_FALLBACK,
      instructionIndex: index,
    });
    expect(sameInstructionSlot(resolved, product)).toBe(true);
  });
});

describe('fallbackNotice', () => {
  const donor = {
    level: 1 as const,
    flags: 0,
    registrationNumber: 'ЛП-000594',
    tradeName: 'НУРОФЕН',
    holder: 'Рекитт Бенкизер',
    dosageForm: 'ТАБЛЕТКИ',
    strength: '200.0 мг',
  };

  it('level 1 carries the label and the donor, no warning', () => {
    const notice = fallbackNotice(donor);
    expect(notice.label).toBe(FALLBACK_LABEL);
    expect(notice.label).toBe(
      'Инструкция другого производителя: то же вещество, форма и дозировка',
    );
    expect(notice.warnings).toEqual([]);
    expect(notice.sourceFacts).toEqual([
      { term: 'Препарат-источник', value: 'Нурофен' },
      { term: 'Регистрация', value: 'ЛП-000594' },
      { term: 'Держатель', value: 'Рекитт Бенкизер' },
      { term: 'Форма и дозировка', value: 'Таблетки · 200 мг' },
    ]);
  });

  it('level 2 does not claim the same strength and adds the strength warning', () => {
    const notice = fallbackNotice({ ...donor, level: 2, flags: FALLBACK_FLAG_STRENGTH_DIFFERS });
    expect(notice.label).toBe(FALLBACK_LABEL_WITH_DIFFERENCES);
    expect(notice.label).not.toContain('дозировка');
    expect(notice.warnings).toEqual(['Дозировка отличается: проверьте дозы по своему препарату']);
  });

  it('names an unstated strength and a different form wording separately', () => {
    expect(fallbackWarnings(FALLBACK_FLAG_STRENGTH_UNKNOWN)).toEqual([
      'Дозировка в реестре не указана: проверьте дозы по своему препарату',
    ]);
    expect(
      fallbackWarnings(FALLBACK_FLAG_FORM_DIFFERS | FALLBACK_FLAG_STRENGTH_DIFFERS),
    ).toHaveLength(2);
    expect(fallbackWarnings(0)).toEqual([]);
  });
});

describe('source class of a product text', () => {
  it('marks only a text that comes from a holder site', () => {
    const products = parseEsklpMedicationProducts(
      CARD,
      new Map([
        ['R-DONOR', 'grls.doc.1'],
        ['R-TARGET', 'site.doc.1'],
      ]),
      new Map([
        ['R-DONOR', 'grls'],
        ['R-TARGET', 'manufacturer-site'],
      ]),
    );
    const byRegistration = (registration: string) =>
      products.find((item) => item.registrationNumber === registration);
    expect(byRegistration('R-TARGET')?.instructionSourceClass).toBe('manufacturer-site');
    expect(byRegistration('R-DONOR')?.instructionSourceClass).toBeUndefined();
    expect(byRegistration('R-OTHER-STRENGTH')?.instructionSourceClass).toBeUndefined();
  });
});
