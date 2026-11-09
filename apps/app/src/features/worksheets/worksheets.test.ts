import { describe, expect, it } from 'vitest';

import { builtInWorksheetsFrom } from '@/features/worksheets/built-in-worksheets';
import seed from '@/features/worksheets/cbt-worksheets.ru.json';
import {
  activeWorksheetFields,
  copyWorksheet,
  createUserWorksheetDraft,
  isNumericField,
  parseUserWorksheet,
  USER_WORKSHEET_FORMAT,
  USER_WORKSHEET_VERSION,
  type UserWorksheet,
  WORKSHEET_GROUPS,
  WorksheetFormatError,
  worksheetHourRows,
  worksheetPatientCare,
  worksheetPatientNote,
} from '@/state/user-worksheet-format';

const builtIns = builtInWorksheetsFrom(seed);

function sheet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: USER_WORKSHEET_FORMAT,
    version: USER_WORKSHEET_VERSION,
    id: 'own-test',
    title: 'Лист',
    group: 'self-monitoring',
    layout: 'log',
    fields: [{ id: 'a', type: 'text', label: 'Поле', patientHint: '', doctorHint: '' }],
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('built-in CBT worksheets', () => {
  it('covers every group of the owner’s list', () => {
    const groups = new Set(builtIns.map((worksheet) => worksheet.group));
    expect([...groups].toSorted()).toEqual([...WORKSHEET_GROUPS].toSorted());
    expect(builtIns.length).toBeGreaterThanOrEqual(25);
  });

  it('gives every sheet both explanations and marks it a draft for the doctor', () => {
    for (const worksheet of builtIns) {
      expect(worksheet.doctorNote, worksheet.id).not.toBe('');
      expect(worksheet.patientNote, worksheet.id).not.toBe('');
      expect(worksheet.summary, worksheet.id).not.toBe('');
      expect(worksheet.draft, worksheet.id).toBe(true);
      expect(worksheet.edition, worksheet.id).toBe(seed.edition);
    }
  });

  it('explains every field to the patient', () => {
    for (const worksheet of builtIns) {
      for (const field of worksheet.fields) {
        expect(field.patientHint, `${worksheet.id}/${field.id}`).not.toBe('');
      }
    }
  });

  it('keeps links out of the texts: sources are their own list', () => {
    const texts = JSON.stringify(
      seed.worksheets.map(({ sources: _sources, ...worksheet }) => worksheet),
    );
    expect(texts).not.toMatch(/https?:\/\//u);
    expect(texts).not.toMatch(/www\./u);
    expect(texts).not.toMatch(/Источники:/u);
  });

  it('names the sources every sheet rests on (owner 2026-11-09)', () => {
    for (const worksheet of builtIns) {
      expect(worksheet.sources.length, worksheet.id).toBeGreaterThan(0);
      for (const source of worksheet.sources) {
        expect(source.url ?? source.documentId ?? source.publisher, worksheet.id).toBeDefined();
      }
    }
  });

  it('keeps «к врачу» / «на приём» lines for the patient only (owner 2026-11-09)', () => {
    const referral = /(обратитесь|скажите|сообщите)[^.]*врач|на при[её]м/iu;
    for (const worksheet of builtIns) {
      const shared = [
        worksheet.summary,
        worksheet.patientNote,
        ...worksheet.sections.map((section) => section.text),
        ...worksheet.fields.map((field) => field.patientHint),
        ...worksheet.variants.map((variant) => variant.patientNote),
      ];
      for (const text of shared) expect(text, worksheet.id).not.toMatch(referral);
    }
    const exposure = builtIns.find((worksheet) => worksheet.id === 'cbt-exposure-log');
    expect(worksheetPatientCare({ ...(exposure as UserWorksheet), variant: 'imaginal' })).toContain(
      'обратитесь к врачу',
    );
    expect(worksheetPatientCare({ ...(exposure as UserWorksheet), variant: 'in-vivo' })).toBe('');
  });

  it('rejects a source link that is not https', () => {
    const [first] = seed.worksheets;
    expect(() =>
      builtInWorksheetsFrom({
        edition: seed.edition,
        worksheets: [{ ...first, sources: [{ title: 'Статья', url: 'http://example.org' }] }],
      }),
    ).toThrow(/https/u);
  });

  it('has unique ids', () => {
    const ids = builtIns.map((worksheet) => worksheet.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the thought record at 3 columns, 7 in the extended version', () => {
    const record = builtIns.find((worksheet) => worksheet.id === 'cbt-thought-record');
    expect(record).toBeDefined();
    if (!record) return;
    const basic = activeWorksheetFields(record);
    const extended = activeWorksheetFields({ ...record, extended: true });
    // Situation, emotion with its strength, thought: the strength is its own column.
    expect(basic.map((field) => field.id)).toEqual([
      'situation',
      'emotion',
      'intensity',
      'thought',
    ]);
    expect(extended).toHaveLength(8);
  });

  it('offers the four exposure variants with their own patient text', () => {
    const log = builtIns.find((worksheet) => worksheet.id === 'cbt-exposure-log');
    expect(log?.variants.map((variant) => variant.id)).toEqual([
      'in-vivo',
      'interoceptive',
      'erp',
      'imaginal',
    ]);
    if (!log) return;
    expect(worksheetPatientNote({ ...log, variant: 'erp' })).toContain('ритуал');
  });

  it('charts only numbers', () => {
    for (const worksheet of builtIns) {
      for (const field of worksheet.fields) {
        if (field.chart) expect(isNumericField(field.type), field.id).toBe(true);
      }
    }
  });
});

describe('worksheet format', () => {
  it('parses a minimal sheet with defaults', () => {
    const worksheet = parseUserWorksheet(sheet());
    expect(worksheet.rows).toBe(8);
    expect(worksheet.extended).toBe(false);
    expect(worksheet.sections).toEqual([]);
  });

  it('refuses other formats, unknown layouts and field types', () => {
    expect(() => parseUserWorksheet(sheet({ format: 'minimed-questionnaire' }))).toThrow(
      WorksheetFormatError,
    );
    expect(() => parseUserWorksheet(sheet({ layout: 'grid' }))).toThrow(WorksheetFormatError);
    expect(() =>
      parseUserWorksheet(
        sheet({ fields: [{ id: 'a', type: 'html', label: 'x', patientHint: '', doctorHint: '' }] }),
      ),
    ).toThrow(WorksheetFormatError);
  });

  it('refuses field ids the diary cannot store', () => {
    expect(() =>
      parseUserWorksheet(
        sheet({
          fields: [{ id: 'A b', type: 'text', label: 'x', patientHint: '', doctorHint: '' }],
        }),
      ),
    ).toThrow(WorksheetFormatError);
  });

  it('needs two different options for a choice', () => {
    const choice = (options: readonly string[]) =>
      sheet({
        fields: [{ id: 'a', type: 'choice', label: 'x', options, patientHint: '', doctorHint: '' }],
      });
    expect(() => parseUserWorksheet(choice(['да']))).toThrow(WorksheetFormatError);
    expect(() => parseUserWorksheet(choice(['да', 'да']))).toThrow(WorksheetFormatError);
    expect(parseUserWorksheet(choice(['да', 'нет'])).fields[0]?.options).toEqual(['да', 'нет']);
  });

  it('refuses a chart of text and a sheet of extended fields only', () => {
    expect(() =>
      parseUserWorksheet(
        sheet({
          fields: [
            { id: 'a', type: 'text', label: 'x', chart: true, patientHint: '', doctorHint: '' },
          ],
        }),
      ),
    ).toThrow(WorksheetFormatError);
    expect(() =>
      parseUserWorksheet(
        sheet({
          fields: [
            { id: 'a', type: 'text', label: 'x', extended: true, patientHint: '', doctorHint: '' },
          ],
        }),
      ),
    ).toThrow(WorksheetFormatError);
  });

  it('needs text in a material and fields elsewhere', () => {
    expect(() => parseUserWorksheet(sheet({ layout: 'material', fields: [] }))).toThrow(
      WorksheetFormatError,
    );
    expect(() => parseUserWorksheet(sheet({ fields: [] }))).toThrow(WorksheetFormatError);
    const material = parseUserWorksheet(
      sheet({ layout: 'material', fields: [], sections: [{ id: 'a', title: 'Т', text: 'Текст' }] }),
    );
    expect(material.rows).toBe(7);
  });

  it('refuses a chosen variant that is not in the list', () => {
    expect(() => parseUserWorksheet(sheet({ variant: 'erp' }))).toThrow(WorksheetFormatError);
  });

  it('prints the hours of an hours sheet', () => {
    const worksheet = parseUserWorksheet(sheet({ layout: 'hours', hours: { from: 22, to: 24 } }));
    expect(worksheetHourRows(worksheet)).toEqual(['22:00', '23:00']);
    expect(() => parseUserWorksheet(sheet({ layout: 'hours', hours: { from: 9, to: 9 } }))).toThrow(
      WorksheetFormatError,
    );
  });

  it('refuses control characters and keeps line breaks in notes', () => {
    expect(() => parseUserWorksheet(sheet({ title: 'a\u0007' }))).toThrow(WorksheetFormatError);
    expect(parseUserWorksheet(sheet({ patientNote: 'Раз\n\nДва  ' })).patientNote).toBe(
      'Раз\n\nДва',
    );
  });

  it('copies a built-in as the doctor’s own version with its origin', () => {
    const source = builtIns[0];
    if (!source) throw new Error('no built-ins');
    const copy = parseUserWorksheet(copyWorksheet(source, '2026-11-09T10:00:00.000Z'));
    expect(copy.id).toMatch(/^own-/u);
    expect(copy.basedOn).toEqual({ id: source.id, version: seed.edition });
    expect(copy.edition).toBeUndefined();
    expect(copy.fields).toEqual(source.fields);
    // A copy of a copy keeps the first origin.
    expect(parseUserWorksheet(copyWorksheet(copy)).basedOn).toEqual(copy.basedOn);
  });

  it('round-trips a new draft through JSON', () => {
    const draft = createUserWorksheetDraft('2026-11-08T00:00:00.000Z');
    expect(parseUserWorksheet(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });
});
