import { describe, expect, it } from 'vitest';

import type { SickLeaveEntry } from '@/features/sick-leave/sick-leave-data';
import {
  entryFootnotes,
  formatPeriod,
  headerText,
  MAX_ENTRIES,
  parsePeriod,
  shownEntries,
  sickLeaveDocumentCodes,
} from '@/features/sick-leave/sick-leave-view';

function entry(
  code: string,
  periods: readonly string[],
  footnotes: readonly string[] = [],
): SickLeaveEntry {
  return {
    code,
    title: `Диагноз ${code}`,
    group: null,
    blockRange: 'A00-A09',
    periods: periods.map((period) => ({ features: '', period, footnotes })),
    footnotes: [],
  };
}

describe('parsePeriod', () => {
  it('reads days, months and the referral mark', () => {
    expect(parsePeriod('9 - 11')).toMatchObject({ from: 9, to: 11, unit: 'days', referral: false });
    expect(parsePeriod('4 - 5 мес.')).toMatchObject({ from: 4, to: 5, unit: 'months' });
    expect(parsePeriod('35 - 50, МСЭ')).toMatchObject({ referral: true, referralPossible: false });
    expect(parsePeriod('90 - 130 возможно МСЭ')).toMatchObject({
      referral: true,
      referralPossible: true,
    });
    expect(parsePeriod('2,5 - 3 мес.')).toMatchObject({ from: 2.5, to: 3 });
    expect(parsePeriod('120')).toMatchObject({ from: 120, to: 120 });
  });

  it('returns null for text it does not know', () => {
    expect(parsePeriod('по решению ВК')).toBeNull();
    expect(parsePeriod('')).toBeNull();
  });
});

describe('formatPeriod', () => {
  it('agrees «день» with the last number', () => {
    expect(formatPeriod('1 - 3')).toBe('1–3 дня');
    expect(formatPeriod('9 - 11')).toBe('9–11 дней');
    expect(formatPeriod('10 - 21')).toBe('10–21 день');
    expect(formatPeriod('20 - 22')).toBe('20–22 дня');
    expect(formatPeriod('12 - 14')).toBe('12–14 дней');
    expect(formatPeriod('1')).toBe('1 день');
    expect(formatPeriod('7')).toBe('7 дней');
  });

  it('keeps months, decimals and the referral mark', () => {
    expect(formatPeriod('4 - 5 мес.')).toBe('4–5 мес.');
    expect(formatPeriod('2,5 - 3 мес.')).toBe('2,5–3 мес.');
    expect(formatPeriod('35 - 50, МСЭ')).toBe('35–50 дней, МСЭ');
    expect(formatPeriod('90 - 130 возможно МСЭ')).toBe('90–130 дней, возможно МСЭ');
  });

  it('returns unknown text as printed', () => {
    expect(formatPeriod('по решению ВК')).toBe('по решению ВК');
  });
});

describe('headerText', () => {
  it('names the span for one diagnosis', () => {
    expect(headerText([entry('A00', ['9 - 11', '15 - 20'])], 0)).toBe('Больничный: 9–20 дней');
  });

  it('counts the diagnoses for several', () => {
    const rows = [entry('A01.0', ['34 - 45']), entry('A01.1', ['30 - 40'])];
    expect(headerText(rows, 0)).toBe('Больничный: сроки для 2 диагнозов');
    expect(headerText(rows, 3)).toBe('Больничный: сроки для 5 диагнозов');
    expect(headerText(rows, 19)).toBe('Больничный: сроки для 21 диагноза');
  });
});

describe('shownEntries', () => {
  it('drops repeats across codes and cuts a long list', () => {
    const first = entry('A03.-', ['10 - 20']);
    expect(
      shownEntries([
        { code: 'A03.1', entries: [first] },
        { code: 'A03.2', entries: [first] },
      ]).entries,
    ).toHaveLength(1);
    const many = Array.from({ length: MAX_ENTRIES + 3 }, (_, index) =>
      entry(`B${String(index).padStart(2, '0')}`, ['5']),
    );
    const shown = shownEntries([{ code: 'B00', entries: many }]);
    expect(shown.entries).toHaveLength(MAX_ENTRIES);
    expect(shown.rest).toBe(3);
  });
});

describe('entryFootnotes', () => {
  it('numbers distinct footnotes in order of first use', () => {
    const rows: SickLeaveEntry = {
      ...entry('I05.-', []),
      periods: [
        {
          features: 'I ФК',
          period: '20 - 30',
          footnotes: ['ФК - функциональный класс.', 'Возможно МСЭ.'],
        },
        { features: 'II ФК', period: '30 - 40', footnotes: ['Возможно МСЭ.'] },
        { features: 'III ФК', period: '40 - 60', footnotes: [] },
      ],
    };
    expect(entryFootnotes(rows)).toEqual({
      texts: ['ФК - функциональный класс.', 'Возможно МСЭ.'],
      titleMark: '',
      rowMarks: ['1,2', '2', ''],
    });
  });
});

describe('sickLeaveDocumentCodes', () => {
  it('reads an ICD-10 card code and a clinical recommendation’s codes', () => {
    expect(
      sickLeaveDocumentCodes({ sourceType: 'rls_mkb_reference', metadata: { mkbCode: 'A00' } }),
    ).toEqual(['A00']);
    expect(
      sickLeaveDocumentCodes({
        sourceType: 'clinical_recommendation',
        metadata: { icd10Codes: ['J18.9', 'J15'] },
      }),
    ).toEqual(['J18.9', 'J15']);
  });

  it('ignores codes a drug or a staging document only mentions', () => {
    expect(
      sickLeaveDocumentCodes({ sourceType: 'allmed_reference', metadata: { icd10Codes: ['I10'] } }),
    ).toEqual([]);
    expect(
      sickLeaveDocumentCodes({
        sourceType: 'medical_reference',
        metadata: { icd10Codes: ['C50'] },
      }),
    ).toEqual([]);
  });
});
