import { describe, expect, it } from 'vitest';

import { createSafetyBuilder, formClassOf } from './safety-build';
import { fixtureDocument, IBUPROFEN_SECTIONS } from './safety-test-fixtures';

const CARD = {
  id: 'esklp.mnn.ибупрофен',
  name: 'ИБУПРОФЕН',
  synonyms: [],
  components: [],
  atcCodes: ['M01AE01'],
};

describe('formClassOf', () => {
  it('takes the first word of the dosage form', () => {
    expect(formClassOf('Таблетки, покрытые пленочной оболочкой')).toBe('таблетки');
    expect(formClassOf('мазь глазная')).toBe('мазь');
    expect(formClassOf(null)).toBe('');
  });
});

describe('createSafetyBuilder', () => {
  it('keeps one instruction per dosage form, the most common form first', () => {
    const builder = createSafetyBuilder({
      cards: [{ ...CARD, registrationKeys: ['ЛП-1', 'ЛП-2', 'ЛП-3', 'ЛП-4'] }],
    });
    builder.addModule({ id: 'm', version: '1', sha256: 'sha256:x' }, [
      fixtureDocument('a', 'А', 'ЛП-1', 'таблетки', IBUPROFEN_SECTIONS),
      fixtureDocument('b', 'Б', 'ЛП-2', 'таблетки', IBUPROFEN_SECTIONS),
      fixtureDocument('c', 'В', 'ЛП-3', 'таблетки', IBUPROFEN_SECTIONS),
      fixtureDocument('d', 'Г', 'ЛП-4', 'гель', []),
    ]);
    const { asset, report } = builder.finish();
    expect(Object.keys(asset.documents).toSorted()).toEqual(['a', 'd']);
    expect(asset.documents['a']?.n).toBe(3);
    expect(asset.documents['d']?.n).toBe(1);
    expect(report.summary['documents']).toBe(4);
    expect(report.summary['documentsIndexed']).toBe(2);
    expect(report.summary['cardsWithPregnancySection']).toBe(1);
  });

  it('matches a document to its card by the registered МНН when no registration is known', () => {
    const builder = createSafetyBuilder({ cards: [{ ...CARD, registrationKeys: [] }] });
    builder.addModule({ id: 'm', version: '1', sha256: 'sha256:x' }, [
      { ...fixtureDocument('a', 'А', 'ЛП-9', 'таблетки', IBUPROFEN_SECTIONS), inn: 'Ибупрофен' },
      fixtureDocument('b', 'Б', 'ЛП-8', 'таблетки', IBUPROFEN_SECTIONS),
    ]);
    const { asset, report } = builder.finish();
    expect(Object.keys(asset.documents)).toEqual(['a']);
    expect(report.documentsWithoutCard).toEqual(['b']);
  });

  it('is deterministic', () => {
    const run = () => {
      const builder = createSafetyBuilder({
        cards: [{ ...CARD, registrationKeys: ['ЛП-1', 'ЛП-2'] }],
      });
      builder.addModule({ id: 'm', version: '1', sha256: 'sha256:x' }, [
        fixtureDocument('b', 'Б', 'ЛП-2', 'гель', IBUPROFEN_SECTIONS),
        fixtureDocument('a', 'А', 'ЛП-1', 'таблетки', IBUPROFEN_SECTIONS),
      ]);
      return JSON.stringify(builder.finish().asset);
    };
    expect(run()).toBe(run());
  });
});
