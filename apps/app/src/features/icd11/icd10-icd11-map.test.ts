import { describe, expect, it } from 'vitest';

import { icd10ChapterOf } from '@/features/icd11/icd10-chapters';
import {
  type Icd10Icd11Data,
  type Icd10Icd11Ref,
  type Icd10Icd11TargetRow,
  icd10ToIcd11,
  loadIcd10Icd11Data,
  normalizeIcd10Code,
  parseIcd10Icd11Data,
} from '@/features/icd11/icd10-icd11-map';

const FIXTURE_TARGETS: readonly Icd10Icd11TargetRow[] = [
  ['257068234', '1A00', 'Холера', 0, '01'],
  ['1397288146/unspecified', '8A6Z', 'Эпилепсия или приступы, неуточнённые', 0, '08'],
  ['142052508/unspecified', 'CA40.Z', 'Пневмония, неуточнённая', 0, '12'],
  ['142052508/other', 'CA40.Y', 'Другая уточнённая пневмония', 0, '12'],
  ['603645706/unspecified', '4B40.Z', 'Diseases of thymus, unspecified', 1, '04'],
  ['264268169', '', 'Inherited cancer-predisposing syndromes', 1 | 2 | 4, '02'],
  ['1000', '8B11', 'Церебральный ишемический инфаркт', 0, '08'],
];

const FIXTURE: Icd10Icd11Data = {
  citation: 'Таблицы соответствия ВОЗ МКБ-10 ↔ МКБ-11, выпуск 2026-01',
  release: '2026-01',
  tables: { one: '10To11MapToOneCategory.txt', multiple: '10To11MapToMultipleCategories.txt' },
  chapters: { '01': 'Инфекционные болезни', '08': 'Болезни нервной системы', '12': 'Дыхание' },
  parts: { XN8P1: ['Vibrio cholerae O1, biovar cholerae', 1] },
  targets: FIXTURE_TARGETS,
  one: {
    A00: 0,
    'A00.0': [0, '1A00&XN8P1'],
    G40: 1,
    'G40.1': 1,
    'G40.9': 1,
    'J18.9': 2,
    'I63.9': 6,
    D37: 5,
    'N83.9': 2,
    E32: 4,
  },
  multiple: {
    'J18.9': [3],
    'N83.9': [2, 3],
    'B99.9': [3],
  },
};

describe('normalizeIcd10Code', () => {
  it('normalizes case, spaces, daggers and Cyrillic lookalikes', () => {
    expect(normalizeIcd10Code('g40.9')).toBe('G40.9');
    expect(normalizeIcd10Code(' G40 . 9 ')).toBe('G40.9');
    expect(normalizeIcd10Code('А00.0')).toBe('A00.0');
    expect(normalizeIcd10Code('A02.2†')).toBe('A02.2');
    expect(normalizeIcd10Code('G40')).toBe('G40');
  });

  it('rejects ranges, blocks and non-codes', () => {
    expect(normalizeIcd10Code('G40-G47')).toBeNull();
    expect(normalizeIcd10Code('G40–G47')).toBeNull();
    expect(normalizeIcd10Code('')).toBeNull();
    expect(normalizeIcd10Code('эпилепсия')).toBeNull();
    expect(normalizeIcd10Code('8A60.Z')).toBeNull();
  });
});

describe('icd10ChapterOf', () => {
  it('reads the ICD-10 chapter from the code ranges', () => {
    expect(icd10ChapterOf('A00.0')).toBe('I');
    expect(icd10ChapterOf('D48.9')).toBe('II');
    expect(icd10ChapterOf('D50.9')).toBe('III');
    expect(icd10ChapterOf('G40.9')).toBe('VI');
    expect(icd10ChapterOf('H59.9')).toBe('VII');
    expect(icd10ChapterOf('H60.0')).toBe('VIII');
    expect(icd10ChapterOf('T98.3')).toBe('XIX');
    expect(icd10ChapterOf('V01')).toBe('XX');
    expect(icd10ChapterOf('U07.1')).toBe('XXII');
    expect(icd10ChapterOf('D49')).toBeNull();
    expect(icd10ChapterOf('G40-G47')).toBeNull();
  });
});

describe('icd10ToIcd11', () => {
  it('gives nothing for unknown codes, ranges and blocks', () => {
    expect(icd10ToIcd11(FIXTURE, 'Z99.9')).toBeNull();
    expect(icd10ToIcd11(FIXTURE, 'G40-G47')).toBeNull();
    expect(icd10ToIcd11(FIXTURE, 'не код')).toBeNull();
  });

  it('maps one category with WHO title, chapter and the ICD-11 card id', () => {
    const result = icd10ToIcd11(FIXTURE, 'a00');
    expect(result?.icd10Code).toBe('A00');
    expect(result?.icd10Chapter).toBe('I');
    expect(result?.oneCategory).toMatchObject({
      code: '1A00',
      title: 'Холера',
      titleLanguage: 'ru',
      chapter: '01',
      chapterTitle: 'Инфекционные болезни',
      documentId: 'who.icd11.mms.257068234',
    });
    expect(result?.tablesAgree).toBe(true);
    expect(result?.labels.map((label) => label.id)).toEqual(['single']);
    expect(result?.citation).toBe('Таблицы соответствия ВОЗ МКБ-10 ↔ МКБ-11, выпуск 2026-01');
  });

  it('turns the «/unspecified» entity into a dotted card id', () => {
    expect(icd10ToIcd11(FIXTURE, 'G40.9')?.oneCategory?.documentId).toBe(
      'who.icd11.mms.1397288146.unspecified',
    );
  });

  it('labels a merge only for unrelated codes that share the target', () => {
    const result = icd10ToIcd11(FIXTURE, 'G40.9');
    // G40 is the parent category and shares the target by construction; G40.1 is a sibling.
    expect(result?.mergedWith).toEqual(['G40.1']);
    expect(result?.labels.map((label) => label.id)).toEqual(['single', 'merged']);
    expect(icd10ToIcd11(FIXTURE, 'G40')?.mergedWith).toEqual([]);
  });

  it('labels a postcoordinated cluster and keeps WHO titles of its extension codes', () => {
    const result = icd10ToIcd11(FIXTURE, 'A00.0');
    expect(result?.oneCategory?.cluster).toBe('1A00&XN8P1');
    expect(result?.oneCategory?.code).toBe('1A00');
    expect(result?.oneCategory?.clusterParts).toEqual([
      { code: 'XN8P1', title: 'Vibrio cholerae O1, biovar cholerae', titleLanguage: 'en' },
    ]);
    expect(result?.labels.map((label) => label.id)).toEqual(['cluster']);
    // The same entity without the cluster is a different target: A00 is not «merged» with A00.0.
    expect(result?.mergedWith).toEqual([]);
  });

  it('reports a split with the right Russian plural', () => {
    const result = icd10ToIcd11(FIXTURE, 'N83.9');
    expect(result?.multipleCategories.map((item) => item.code)).toEqual(['CA40.Z', 'CA40.Y']);
    expect(result?.labels.find((label) => label.id === 'split')?.text).toBe(
      'разделено на 2 рубрики',
    );
    expect(result?.tablesAgree).toBe(false);
    // The «одна категория» answer is one of the several, so the tables do not contradict each other.
    expect(result?.tablesConflict).toBe(false);
    expect(result?.labels.map((label) => label.id)).not.toContain('tables-differ');
    expect(result?.all.map((item) => item.code)).toEqual(['CA40.Z', 'CA40.Y']);
  });

  it.each([
    [3, 'разделено на 3 рубрики'],
    [5, 'разделено на 5 рубрик'],
    [11, 'разделено на 11 рубрик'],
    [21, 'разделено на 21 рубрику'],
    [22, 'разделено на 22 рубрики'],
  ])('writes %i split rubrics as «%s»', (count, text) => {
    const refs: Icd10Icd11Ref[] = Array.from({ length: count }, () => 0);
    // Distinct clusters make distinct targets of the same entity.
    const clustered = refs.map((_, index): Icd10Icd11Ref => [0, `1A00&X${String(index)}`]);
    const data: Icd10Icd11Data = {
      ...FIXTURE,
      one: { 'A09.9': 0 },
      multiple: { 'A09.9': clustered },
    };
    expect(icd10ToIcd11(data, 'A09.9')?.labels.find((label) => label.id === 'split')?.text).toBe(
      text,
    );
  });

  it('shows both tables when they disagree', () => {
    const result = icd10ToIcd11(FIXTURE, 'J18.9');
    expect(result?.oneCategory?.code).toBe('CA40.Z');
    expect(result?.multipleCategories.map((item) => item.code)).toEqual(['CA40.Y']);
    expect(result?.tablesAgree).toBe(false);
    expect(result?.tablesConflict).toBe(true);
    expect(result?.all.map((item) => item.code)).toEqual(['CA40.Z', 'CA40.Y']);
    expect(result?.labels.map((label) => label.id)).toContain('tables-differ');
    expect(result?.labels.map((label) => label.id)).not.toContain('single');
  });

  it('flags a target in a chapter without a counterpart of the ICD-10 chapter', () => {
    // Cerebral infarction: ICD-10 chapter IX, ICD-11 chapter 08 (nervous system).
    expect(icd10ToIcd11(FIXTURE, 'I63.9')?.labels.map((label) => label.id)).toContain(
      'other-chapter',
    );
    expect(icd10ToIcd11(FIXTURE, 'G40.9')?.labels.map((label) => label.id)).not.toContain(
      'other-chapter',
    );
  });

  it('keeps an English WHO title marked and a block without a card', () => {
    expect(icd10ToIcd11(FIXTURE, 'E32')?.oneCategory).toMatchObject({
      title: 'Diseases of thymus, unspecified',
      titleLanguage: 'en',
    });
    const block = icd10ToIcd11(FIXTURE, 'D37')?.oneCategory;
    expect(block).toMatchObject({ code: null, kind: 'block', documentId: null });
    expect(block?.titleLanguage).toBe('en');
  });

  it('answers from the multiple-category table alone when the other has no row', () => {
    const result = icd10ToIcd11(FIXTURE, 'B99.9');
    expect(result?.oneCategory).toBeNull();
    expect(result?.multipleCategories.map((item) => item.code)).toEqual(['CA40.Y']);
    expect(result?.tablesAgree).toBe(false);
    expect(result?.tablesConflict).toBe(false);
  });
});

describe('parseIcd10Icd11Data', () => {
  it('rejects a payload of the wrong shape', () => {
    expect(() => parseIcd10Icd11Data({ release: '2026-01' })).toThrow('unexpected shape');
    expect(() => parseIcd10Icd11Data(null)).toThrow('unexpected shape');
    expect(parseIcd10Icd11Data(FIXTURE).release).toBe('2026-01');
  });
});

describe('bundled asset', () => {
  it('loads, keeps the release header and resolves a known code', async () => {
    const data = await loadIcd10Icd11Data();
    expect(data.release).toBe('2026-01');
    expect(data.citation).toContain('выпуск 2026-01');
    const result = icd10ToIcd11(data, 'G40.9');
    expect(result?.oneCategory?.code).toBe('8A6Z');
    expect(result?.oneCategory?.documentId).toBe('who.icd11.mms.1397288146.unspecified');
  });
});
