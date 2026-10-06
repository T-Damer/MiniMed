import { describe, expect, it } from 'vitest';

import {
  type ComparisonBuildCard,
  type ComparisonBuildDocument,
  companyKey,
  createComparisonBuilder,
  normalizeStrength,
  registryFacts,
  sectionMask,
} from './comparison-build';
import { parseComparisonIndex, ROW_MASK, SECTION_BITS } from './comparison-index';

const normalizeRegistration = (value: string): string => value.replace(/\s+/gu, '').toLowerCase();

describe('registryFacts', () => {
  it('reads forms, strengths, ЖНВЛП flags and the counts of an ЕСКЛП card', () => {
    const facts = registryFacts(
      {
        smnnNodes: [
          {
            dosageForm: 'ТАБЛЕТКИ',
            strength: '200.0мг',
            essentialDrug: true,
            pharmacotherapeuticGroup: 'НПВП',
            tradeNames: [{ tradeName: 'Нурофен®', registrationNumber: 'ЛП-1' }],
            klpPositions: [
              {
                tradeName: 'Нурофен',
                registrationNumber: 'ЛП-1',
                manufacturer: 'ООО "Ромашка"',
                holder: 'АО Ромашка',
              },
              { tradeName: 'Ибупрофен', registrationNumber: 'ЛП-2', manufacturer: 'Ромашка Ltd.' },
            ],
          },
          { dosageForm: 'ТАБЛЕТКИ', strength: '400 мг', essentialDrug: false },
        ],
      },
      normalizeRegistration,
    );
    const tablets = facts.forms.get('таблетки');
    expect([...(tablets?.strengths ?? [])]).toEqual(['200 мг', '400 мг']);
    expect(tablets?.essential).toBe(3);
    expect(facts.registrations.size).toBe(2);
    expect(facts.tradeNames.size).toBe(2);
    expect(facts.manufacturers.size).toBe(1);
    expect([...facts.groups]).toEqual(['НПВП']);
  });

  it('normalises strengths and company names', () => {
    expect(normalizeStrength('1.0мг/мл')).toBe('1 мг/мл');
    expect(normalizeStrength('0.5 г')).toBe('0,5 г');
    expect(normalizeStrength('~')).toBeNull();
    expect(companyKey('ООО «Ромашка», Россия')).toBe(companyKey('Ромашка ООО россия'));
  });
});

const facts = registryFacts(
  {
    smnnNodes: [
      {
        dosageForm: 'таблетки',
        strength: '200 мг',
        klpPositions: [{ registrationNumber: 'ЛП-1' }],
      },
    ],
  },
  normalizeRegistration,
);
const card = (id: string, name: string, keys: readonly string[]): ComparisonBuildCard => ({
  id: `esklp.mnn.${id}`,
  name,
  synonyms: [],
  components: [],
  atcCodes: ['M01AE01'],
  registrationKeys: keys,
  facts,
});
const document = (
  id: string,
  registrationKeys: readonly string[],
  types: readonly string[],
): ComparisonBuildDocument => ({
  id,
  kind: 'national-instruction',
  sourceClass: 'grls',
  tradeName: 'Нурофен',
  inn: null,
  dosageForm: 'Таблетки',
  registrationKeys,
  sections: types.map((type) => ({ type, title: type, hasText: true })),
});

describe('createComparisonBuilder', () => {
  it('maps documents to cards by registration, masks their sections and builds a valid asset', () => {
    const builder = createComparisonBuilder({
      cards: [
        card('ибупрофен', 'ИБУПРОФЕН', ['лп-1']),
        card('парацетамол', 'ПАРАЦЕТАМОЛ', ['лп-2']),
      ],
      register: new Map([
        ['лп-1', 'rx' as const],
        ['лп-2', 'otc' as const],
      ]),
      editions: { esklp: '2026-08-28', grls: '02.10.2026' },
    });
    builder.addModule({ id: 'm', version: '1', sha256: 'sha256:x' }, [
      document(
        'd1',
        ['лп-1'],
        [
          'indications',
          'contraindications',
          'dosage',
          'adverse-effects',
          'special-instructions',
          'overdose',
        ],
      ),
      document('d2', ['лп-2'], ['indications']),
      document('d3', ['лп-404'], ['indications']),
    ]);
    const { asset, report } = builder.finish();
    expect(report.summary).toMatchObject({
      documents: 3,
      documentsWithoutCard: 1,
      documentsIndexed: 2,
    });
    expect(asset.documents['d1']?.y).toBe(ROW_MASK);
    expect(asset.documents['d2']?.y).toBe(SECTION_BITS.indications);
    expect(asset.cards[0]?.x).toEqual([1, 0, 0, 0]);
    expect(asset.cards[1]?.x).toEqual([0, 1, 0, 0]);
    // The asset survives its own validation at the package boundary.
    expect(parseComparisonIndex(JSON.parse(JSON.stringify(asset))).cards).toHaveLength(2);
    expect(report.top200.withInstruction).toBe(2);
    expect(report.top200.allSixRowsInBestInstruction).toBe(1);
  });

  it('marks the pharmacotherapeutic group and dispensing lines only on the matching titles', () => {
    expect(
      sectionMask([
        { type: 'pharmacology', title: 'Фармакотерапевтическая группа', hasText: true },
        { type: 'dispensing', title: 'Условия отпуска', hasText: true },
      ]),
    ).toBe(SECTION_BITS.group | SECTION_BITS.dispensing);
    expect(sectionMask([{ type: 'pharmacology', title: 'Фармакодинамика', hasText: true }])).toBe(
      0,
    );
    expect(sectionMask([{ type: 'dosage', title: 'Дозы', hasText: false }])).toBe(0);
  });
});

describe('parseComparisonIndex', () => {
  it('rejects a malformed asset instead of reading it as empty', () => {
    expect(() => parseComparisonIndex(null)).toThrow(/not an object/u);
    expect(() => parseComparisonIndex({ schemaVersion: 99 })).toThrow(/schema version/u);
  });
});
