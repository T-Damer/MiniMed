import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import { localMedError } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  fixtureIndex,
  instruction,
  section,
} from '@/features/drug-comparison/comparison-test-fixtures';
import {
  buildMedicationLinkSummary,
  instructionEffect,
  leadingSentences,
  loadMedicationLinkSummary,
  pointerTradeNames,
} from '@/features/library/medication-link-preview';
import type { AtcNameCatalog } from '@/features/medications/atc-code';

const atcNames: AtcNameCatalog = {
  source: 'НСИ',
  version: '3.8',
  publishDate: '2025-07-15',
  names: {
    M: 'Костно-мышечная система',
    M01: 'Противовоспалительные и противоревматические препараты',
    M01AE: 'производные пропионовой кислоты',
  },
};

function pointer(): MedicalDocument {
  return {
    ...instruction('core.catalog.pointer.medication.esklp.mnn.ибупрофен-1', [
      section(null, 'smnn — ТАБЛЕТКИ — 200.0мг', [
        '- ТН: Нурофен; форма/дозировка: ТАБЛЕТКИ (200 мг)',
        '- ТН: МИГ 400; форма/дозировка: ТАБЛЕТКИ (400 мг)',
      ]),
    ]),
    title: 'ИБУПРОФЕН',
    sourceType: 'core_catalog_pointer',
    versionLabel: '2026-08-28',
    metadata: {
      contentMode: 'module-pointer',
      catalogFamily: 'medication',
      targetDocumentId: 'esklp.mnn.ибупрофен',
      standardizedInn: 'ИБУПРОФЕН',
    },
  };
}

const ibuprofenInstruction = instruction('drug.rf.a1.instruction', [
  section('pharmacology', 'Фармакотерапевтическая группа', ['НПВП.'], 0),
  section(
    'pharmacology',
    'Фармакодинамика',
    [
      'Фармакодинамика. Ибупрофен обладает анальгезирующим, жаропонижающим и противовоспалительным действием. Механизм действия связан с ингибированием ЦОГ-1 и ЦОГ-2. Третье предложение уже не помещается в короткую подсказку, потому что она должна оставаться короткой и не заменять инструкцию.',
    ],
    1,
  ),
  section('indications', 'Показания к применению', ['Головная боль.'], 2),
]);

describe('drug link summary', () => {
  it('builds the short card from a core pointer and the comparison index', () => {
    const summary = buildMedicationLinkSummary({
      document: pointer(),
      index: fixtureIndex(),
      atcNames,
      instruction: null,
    });
    expect(summary).toEqual({
      title: 'Ибупрофен',
      substance: null,
      tradeNames: ['Нурофен', 'Миг 400', 'Ибупрофен гель', 'Ибупрофен'],
      moreTradeNames: 0,
      groups: ['Нестероидное противовоспалительное средство'],
      atc: { code: 'M01AE01', name: 'Производные пропионовой кислоты' },
      effect: null,
      sourceLine: 'ЕСКЛП, 28.08.2026',
    });
  });

  it('quotes the pharmacodynamics, not the group line, cut at a sentence', () => {
    expect(instructionEffect(ibuprofenInstruction)).toEqual({
      label: 'Действие',
      text: 'Ибупрофен обладает анальгезирующим, жаропонижающим и противовоспалительным действием. Механизм действия связан с ингибированием ЦОГ-1 и ЦОГ-2.',
    });
  });

  it('falls back to the indications when the instruction has no pharmacology text', () => {
    const leaflet = instruction('leaflet', [
      section('indications', 'Показания к применению', ['Показания к применению Головная боль.']),
    ]);
    expect(instructionEffect(leaflet)).toEqual({ label: 'Показания', text: 'Головная боль.' });
  });

  it('cuts a single long sentence at a word boundary', () => {
    const text = `${'слово '.repeat(60)}конец.`;
    const cut = leadingSentences(text, 40);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(41);
    expect(cut).not.toMatch(/\s…$/u);
  });

  it('keeps the more specific of two groups that start alike', () => {
    const document = pointer();
    const index = fixtureIndex();
    const card = index.asset.cards[0];
    if (!card) throw new Error('fixture card missing');
    const summary = buildMedicationLinkSummary({
      document,
      index: {
        ...index,
        asset: {
          ...index.asset,
          cards: [{ ...card, g: ['витамины', 'Витамины. Аскорбиновая кислота'] }],
        },
      },
      atcNames: null,
      instruction: null,
    });
    expect(summary.groups).toEqual(['Витамины. Аскорбиновая кислота']);
    expect(summary.atc).toEqual({ code: 'M01AE01', name: null });
  });

  it('reads trade names from pointer lines', () => {
    expect(pointerTradeNames(pointer())).toEqual(['Нурофен', 'МИГ 400']);
  });

  it('uses an installed instruction and skips the ones whose module is missing', async () => {
    const documents = new Map<string, MedicalDocument>([
      [pointer().id, pointer()],
      ['drug.rf.a2.instruction', ibuprofenInstruction],
    ]);
    const requested: string[] = [];
    const core: Pick<MedicalCore, 'getDocument'> = {
      getDocument: async (id) => {
        requested.push(id);
        const document = documents.get(id);
        return document
          ? { ok: true, value: document }
          : { ok: false, error: localMedError('CONTENT_NOT_FOUND', `Document not found: ${id}`) };
      },
    };
    const summary = await loadMedicationLinkSummary(core, pointer().id, {
      comparisonIndex: async () => fixtureIndex(),
      atcNames: async () => atcNames,
    });
    expect(requested).toEqual([
      pointer().id,
      'esklp.mnn.ибупрофен',
      'drug.rf.a1.instruction',
      'drug.rf.a3.instruction',
      'drug.rf.a2.instruction',
    ]);
    expect(summary.effect?.label).toBe('Действие');
    expect(summary.sourceLine).toBe('ЕСКЛП, 28.08.2026 · инструкция');
  });
});
