/** A small, real-shaped index built through the real builder, shared by the unit tests. */
import type { MedicalDocument } from '@localmed/contracts';

import {
  createSafetyBuilder,
  type SafetyBuildDocument,
  type SafetyBuildSection,
} from './safety-build';
import { createSafetyIndex, parseSafetyIndex, type SafetyIndex } from './safety-index';

export interface FixtureSection {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly text: string;
}

export const PREGNANCY_TEXT = [
  'Беременность',
  'Применение препарата в I триместре беременности противопоказано.',
  'Во II и III триместрах препарат применяют только по строгим показаниям.',
  'Грудное вскармливание',
  'Препарат проникает в грудное молоко. При необходимости применения следует прекратить грудное вскармливание.',
  'Фертильность',
  'Данных о влиянии на фертильность нет.',
].join('\n');

export const CONTRAINDICATIONS_TEXT = [
  '- гиперчувствительность к ибупрофену;',
  '- беременность (III триместр), период грудного вскармливания;',
  '- детский возраст до 12 лет;',
  '- масса тела менее 20 кг.',
].join('\n');

export const DOSAGE_TEXT = [
  'Взрослым и детям старше 12 лет назначают по 1 таблетке 3 раза в сутки.',
  'Детям от 6 до 12 лет назначают суспензию по 5 мл 3 раза в сутки.',
].join('\n');

export function fixtureDocument(
  id: string,
  tradeName: string,
  registration: string,
  dosageForm: string,
  sections: readonly FixtureSection[],
  kind = 'national-instruction',
): SafetyBuildDocument {
  return {
    id,
    kind,
    sourceClass: 'grls',
    tradeName,
    inn: null,
    dosageForm,
    registrationKeys: [registration],
    sections: sections.map(
      (section): SafetyBuildSection => ({
        id: section.id,
        type: section.type,
        title: section.title,
        chunks: () => [section.text],
      }),
    ),
  };
}

export const IBUPROFEN_SECTIONS: readonly FixtureSection[] = [
  {
    id: 'section.aaaaaaaaaaaaaaa1',
    type: 'contraindications',
    title: 'Противопоказания',
    text: CONTRAINDICATIONS_TEXT,
  },
  {
    id: 'section.aaaaaaaaaaaaaaa2',
    type: 'pregnancy',
    title: 'Применение при беременности и в период грудного вскармливания',
    text: PREGNANCY_TEXT,
  },
  {
    id: 'section.aaaaaaaaaaaaaaa3',
    type: 'dosage',
    title: 'Способ применения и дозы',
    text: DOSAGE_TEXT,
  },
];

export function buildFixtureIndex(): SafetyIndex {
  const builder = createSafetyBuilder({
    cards: [
      {
        id: 'esklp.mnn.ибупрофен',
        name: 'ИБУПРОФЕН',
        synonyms: [],
        components: [],
        atcCodes: ['M01AE01'],
        registrationKeys: ['ЛП-002', 'ЛП-012'],
      },
      {
        id: 'esklp.mnn.омепразол',
        name: 'ОМЕПРАЗОЛ',
        synonyms: [],
        components: [],
        atcCodes: ['A02BC01'],
        registrationKeys: ['ЛП-004'],
      },
    ],
  });
  builder.addModule(
    { id: 'minimed.medications.instructions.test.ru', version: 't1', sha256: 'sha256:x' },
    [
      fixtureDocument(
        'drug.rf.bbbb.instruction',
        'Ибупрофен-тест',
        'ЛП-002',
        'таблетки',
        IBUPROFEN_SECTIONS,
      ),
      fixtureDocument('drug.rf.bbb2.instruction', 'Ибупрофен-гель', 'ЛП-012', 'гель', [
        {
          id: 'section.bbbbbbbbbbbbbbb1',
          type: 'contraindications',
          title: 'Противопоказания',
          text: 'Нанесение на кожу. Детский возраст до 14 лет.',
        },
      ]),
      fixtureDocument('drug.rf.dddd.instruction', 'Омепразол-тест', 'ЛП-004', 'капсулы', [
        {
          id: 'section.ddddddddddddddd1',
          type: 'indications',
          title: 'Показания к применению',
          text: 'Язвенная болезнь желудка.',
        },
      ]),
    ],
  );
  const { asset } = builder.finish();
  return createSafetyIndex(parseSafetyIndex(JSON.parse(JSON.stringify(asset))));
}

/** The instruction as the core would hand it over: the fixture sections with one chunk each. */
export function fixtureMedicalDocument(
  id: string,
  sections: readonly FixtureSection[],
): MedicalDocument {
  return {
    id,
    title: `${id}: инструкция`,
    shortTitle: null,
    sourceType: 'official_drug_instruction',
    status: 'active',
    specialties: [],
    metadata: { documentKind: 'national-instruction', instructionLabel: 'Изм. № 1' },
    versionId: 'v',
    versionLabel: 'v',
    effectiveFrom: null,
    sections: sections.map((section, position) => ({
      id: section.id,
      documentVersionId: 'v',
      parentSectionId: null,
      title: section.title,
      sectionType: section.type,
      depth: 1,
      orderIndex: position,
      pageStart: null,
      pageEnd: null,
      anchor: `a${position}`,
      sectionPath: [],
      chunks: [
        {
          id: `c${position}`,
          sectionId: section.id,
          documentVersionId: 'v',
          orderIndex: 0,
          originalText: section.text,
          pageStart: null,
          pageEnd: null,
          anchor: `a${position}/chunk`,
        },
      ],
    })),
  };
}
