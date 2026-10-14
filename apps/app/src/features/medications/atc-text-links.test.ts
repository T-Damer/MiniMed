import { describe, expect, it } from 'vitest';

import { atcCodeFromText, segmentTextWithAtcCodes } from './atc-text-links';

const codes = (text: string): string[] =>
  segmentTextWithAtcCodes(text).flatMap((segment) =>
    segment.kind === 'atc' ? [segment.code] : [],
  );

describe('ATC codes in text', () => {
  it('links a full substance code anywhere in a sentence', () => {
    expect(codes('Код АТХ: J05AX13.')).toEqual(['J05AX13']);
    expect(codes('умифеновир (J05AX13) применяют при гриппе')).toEqual(['J05AX13']);
    expect(codes('N02BE01, N02BE51 и M01AE01')).toEqual(['N02BE01', 'N02BE51', 'M01AE01']);
  });

  it('keeps the text around a code unchanged', () => {
    const segments = segmentTextWithAtcCodes('АТХ: J05AX13 — противовирусное');
    expect(segments.map((segment) => segment.value).join('')).toBe(
      'АТХ: J05AX13 — противовирусное',
    );
    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'atc', 'text']);
  });

  it('reads Cyrillic look-alike letters as Latin ones', () => {
    const [segment] = segmentTextWithAtcCodes('С01ВА01').filter((item) => item.kind === 'atc');
    expect(segment).toEqual({ kind: 'atc', value: 'С01ВА01', code: 'C01BA01' });
    expect(codes('АТХ: Н02АВ06')).toEqual(['H02AB06']);
  });

  it('does not apply the Russian-layout reading of a typed query to text', () => {
    expect(codes('о05фч13')).toEqual([]);
  });

  it('links a short code only after the ATC marker, and through the list that follows it', () => {
    expect(codes('Код АТХ: J05AX')).toEqual(['J05AX']);
    expect(codes('ATC code J05')).toEqual(['J05']);
    expect(codes('АТХ — J05A, J05AB и J05AX')).toEqual(['J05A', 'J05AB', 'J05AX']);
    expect(codes('Код АТХ J05AX13, J05')).toEqual(['J05AX13', 'J05']);
  });

  it('leaves ICD-10 codes and bare short codes alone', () => {
    expect(codes('Острый ларингит J05.0 и J05')).toEqual([]);
    expect(codes('диагноз J18.9, J18')).toEqual([]);
    expect(codes('МКБ-10: J05, K25')).toEqual([]);
    expect(codes('диапазон J05-J06')).toEqual([]);
    expect(codes('АТХ J05.1')).toEqual([]);
    // The marker must be near: a sentence later it no longer counts.
    expect(codes('Код АТХ: J05AX13. Пациент с диагнозом J05 направлен.')).toEqual(['J05AX13']);
  });

  it('leaves words, numbers and codes of other kinds alone', () => {
    for (const text of [
      'ВИЧ-инфекция',
      'группа С3 и витамин В12',
      'в 2026 году 12 мг, 05.10',
      'парацетамол 500 мг',
      'ГОСТ Р 12345',
      'артикул ABCDEFG',
      'идентификатор A12BC345',
      'J05AX133',
      'xJ05AX13',
      'J05AX13x',
    ]) {
      expect(codes(text)).toEqual([]);
    }
  });

  it('returns one text part for a text without codes', () => {
    expect(segmentTextWithAtcCodes('просто текст')).toEqual([
      { kind: 'text', value: 'просто текст' },
    ]);
    expect(segmentTextWithAtcCodes('')).toEqual([{ kind: 'text', value: '' }]);
  });
});

describe('atcCodeFromText', () => {
  it('shapes a code met in a text for the code sheet', () => {
    expect(atcCodeFromText('J05AX13', 'J05AX13')).toMatchObject({
      code: 'J05AX13',
      level: 5,
      sourceCode: null,
      substanceName: null,
      consensusSources: [],
    });
    expect(atcCodeFromText('C01BA', 'С01ВА')).toMatchObject({ level: 4, sourceCode: 'С01ВА' });
    expect(atcCodeFromText('J05', 'J05').level).toBe(2);
    expect(atcCodeFromText('J05A', 'J05A').level).toBe(3);
  });
});
