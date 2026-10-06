import type { MedicalDocument, MedicalSection } from '@localmed/contracts';

import {
  COMPARISON_INDEX_SCHEMA_VERSION,
  type ComparisonIndexAsset,
  createComparisonIndex,
  SECTION_BITS,
} from './comparison-index';

const ALL_ROWS =
  SECTION_BITS.indications |
  SECTION_BITS.contraindications |
  SECTION_BITS.dosage |
  SECTION_BITS.adverse |
  SECTION_BITS.special |
  SECTION_BITS.overdose;

/** Two cards (ibuprofen, paracetamol) with instructions in tablets, capsules and a gel. */
export function fixtureAsset(): ComparisonIndexAsset {
  return {
    schemaVersion: COMPARISON_INDEX_SCHEMA_VERSION,
    basis: { esklp: { edition: '2026-08-28' }, grls: { edition: '02.10.2026' }, modules: [] },
    modules: ['minimed.medications.instructions.test.ru'],
    forms: ['таблетки', 'капсулы', 'гель для наружного применения', 'суппозитории ректальные'],
    cards: [
      {
        s: 'ибупрофен',
        n: 'ИБУПРОФЕН',
        a: ['M01AE01'],
        g: ['нестероидное противовоспалительное средство'],
        f: [
          [0, ['200 мг', '400 мг'], 1],
          [2, ['50 мг/г'], 2],
        ],
        r: 155,
        t: 63,
        m: 86,
        h: 84,
        x: [120, 8, 0, 3],
      },
      {
        s: 'парацетамол',
        n: 'ПАРАЦЕТАМОЛ',
        a: ['N02BE01'],
        g: [],
        f: [[0, ['500 мг'], 3]],
        r: 200,
        t: 80,
        m: 90,
        h: 88,
        x: null,
      },
    ],
    documents: {
      'drug.rf.a1.instruction': { c: [0], m: 0, t: 'Нурофен', k: 1, s: 0, f: 0, y: ALL_ROWS },
      'drug.rf.a2.instruction': { c: [0], m: 0, t: 'Ибупрофен', k: 1, s: 0, f: 0, y: ALL_ROWS - 1 },
      'drug.rf.a3.instruction': {
        c: [0],
        m: 0,
        t: 'Ибупрофен гель',
        k: 1,
        s: 0,
        f: 2,
        y: ALL_ROWS,
      },
      'drug.rf.b1.instruction': { c: [1], m: 0, t: 'Панадол', k: 1, s: 0, f: 0, y: ALL_ROWS },
      'drug.rf.b2.instruction': { c: [1], m: 0, t: 'Парацетамол', k: 3, s: 0, f: 3, y: ALL_ROWS },
    },
  };
}

export function fixtureIndex() {
  return createComparisonIndex(fixtureAsset());
}

let chunkCounter = 0;

export function section(
  type: string | null,
  title: string,
  texts: readonly string[],
  orderIndex = 0,
): MedicalSection {
  chunkCounter += 1;
  const id = `section.s${chunkCounter}`;
  return {
    id,
    documentVersionId: 'v1',
    parentSectionId: null,
    title,
    sectionType: type,
    depth: 1,
    orderIndex,
    pageStart: null,
    pageEnd: null,
    anchor: `a-${id}`,
    sectionPath: [title],
    chunks: texts.map((text, index) => ({
      id: `${id}.c${index}`,
      sectionId: id,
      documentVersionId: 'v1',
      orderIndex: index,
      originalText: text,
      pageStart: null,
      pageEnd: null,
      anchor: `${id}-c${index}`,
    })),
  };
}

export function instruction(
  id: string,
  sections: readonly MedicalSection[],
  metadata: Readonly<Record<string, unknown>> = {},
): MedicalDocument {
  return {
    id,
    title: `${id}: инструкция`,
    shortTitle: null,
    sourceType: 'official_drug_instruction',
    status: 'published',
    specialties: [],
    versionId: 'v1',
    versionLabel: '1',
    effectiveFrom: null,
    metadata,
    sections,
  };
}
