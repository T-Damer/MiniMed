import { describe, expect, it } from 'vitest';

import { PATIENT_MEMO } from '@/features/worksheets/assignment-memo';
import { builtInWorksheetsFrom } from '@/features/worksheets/built-in-worksheets';
import seed from '@/features/worksheets/cbt-worksheets.ru.json';
import {
  worksheetPrintHtml,
  worksheetPrintIsLandscape,
} from '@/features/worksheets/worksheet-print';
import type { UserWorksheet } from '@/state/user-worksheet-format';

const builtIns = builtInWorksheetsFrom(seed);

function builtIn(id: string): UserWorksheet {
  const worksheet = builtIns.find((item) => item.id === id);
  if (!worksheet) throw new Error(`no ${id}`);
  return worksheet;
}

function rowsOf(html: string): number {
  return (html.match(/<tr class="(?:short|tall)">/gu) ?? []).length;
}

describe('worksheet print', () => {
  it('prints every built-in with the patient explanation and the memo, never the doctor note', () => {
    for (const worksheet of builtIns) {
      const html = worksheetPrintHtml(worksheet);
      expect(html, worksheet.id).toContain(PATIENT_MEMO.notDone.slice(0, 30));
      const firstPatientLine = worksheet.patientNote.split('\n')[0] ?? '';
      expect(html, worksheet.id).toContain(firstPatientLine.slice(0, 40).replaceAll('«', '«'));
      const firstDoctorLine = (worksheet.doctorNote.split('\n')[0] ?? '').slice(0, 60);
      expect(html, worksheet.id).not.toContain(firstDoctorLine);
    }
  });

  it('prints the basic thought record with 4 columns and the extended one with 8', () => {
    const record = builtIn('cbt-thought-record');
    const basic = worksheetPrintHtml(record);
    const extended = worksheetPrintHtml({ ...record, extended: true });
    expect((basic.match(/<th>/gu) ?? []).length).toBe(4);
    expect((extended.match(/<th>/gu) ?? []).length).toBe(8);
    expect(basic).not.toContain('Доводы против');
    expect(extended).toContain('Доводы против');
    expect(worksheetPrintIsLandscape(record)).toBe(true);
  });

  it('explains what each field means under the blank', () => {
    const html = worksheetPrintHtml(builtIn('cbt-sleep-diary'));
    expect(html).toContain('Что значит каждое поле');
    expect(html).toContain('Когда выключили свет и попробовали уснуть.');
  });

  it('lays out hours, weekdays, steps and a card', () => {
    const hours = worksheetPrintHtml(builtIn('cbt-activity-mood'));
    expect(hours).toContain('<td>06:00</td>');
    expect(hours).toContain('<td>23:00</td>');
    expect(hours).not.toContain('<td>24:00</td>');
    const week = worksheetPrintHtml(builtIn('cbt-week-plan'));
    expect(week).toContain('Воскресенье');
    expect(rowsOf(week)).toBe(21);
    const ladder = worksheetPrintHtml(builtIn('cbt-fear-hierarchy'));
    expect(ladder).toContain('<td class="step">10</td>');
    const card = worksheetPrintHtml(builtIn('cbt-coping-card'));
    expect(card).toContain('class="card"');
    expect(worksheetPrintIsLandscape(builtIn('cbt-coping-card'))).toBe(false);
  });

  it('prints a material with its text and practice log', () => {
    const html = worksheetPrintHtml(builtIn('cbt-pmr'));
    expect(html).toContain('Кисти и руки');
    expect(rowsOf(html)).toBe(7);
    const reading = worksheetPrintHtml(builtIn('cbt-about-depression'));
    expect(reading).toContain('Активность и настроение');
    expect(reading).not.toContain('<table>');
  });

  it('prints the chosen exposure variant', () => {
    const log = builtIn('cbt-exposure-log');
    expect(worksheetPrintHtml({ ...log, variant: 'imaginal' })).toContain('связанными с травмой');
    expect(worksheetPrintHtml({ ...log, variant: 'in-vivo' })).not.toContain(
      'связанными с травмой',
    );
    expect(worksheetPrintHtml({ ...log, variant: 'imaginal' })).toContain('обратитесь к врачу');
  });

  it('prints filled rows first, then empty rows up to the sheet, and escapes them', () => {
    const record = builtIn('cbt-thought-record');
    const html = worksheetPrintHtml(record, [
      {
        at: '2026-11-08T09:30:00.000Z',
        values: {
          situation: 'Совещание <b>',
          emotion: 'тревога',
          intensity: 70,
          thought: 'Я провалюсь',
        },
      },
    ]);
    expect(html).toContain('Совещание &lt;b&gt;');
    expect(html).toContain('<td>70</td>');
    expect(rowsOf(html)).toBe(record.rows);
    const many = Array.from({ length: record.rows + 2 }, () => ({ values: { emotion: 'грусть' } }));
    // A full sheet still ends with one empty row to write on.
    expect(rowsOf(worksheetPrintHtml(record, many))).toBe(record.rows + 3);
  });

  it('prints the assignment and the patient on request', () => {
    const html = worksheetPrintHtml(builtIn('cbt-panic-diary'), [], {
      what: 'После каждой атаки, в тот же день',
      patient: '🦊 Лиса',
    });
    expect(html).toContain('Что и когда делать:</strong> После каждой атаки');
    expect(html).toContain('🦊 Лиса');
  });
});
