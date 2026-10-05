import { describe, expect, it } from 'vitest';

import {
  generalProcedureItems,
  getVaccinationCalendar,
  isAgeRow,
  itemDoseLabel,
  pdfPagesLabel,
  procedureItemsFor,
  sourceOrderNumber,
} from '@/features/vaccination/vaccination-calendar';

describe('vaccination calendar data', () => {
  const calendar = getVaccinationCalendar();

  it('has every row of the three appendices, each citing a page of the official file', () => {
    expect(calendar.national.rows).toHaveLength(19);
    expect(calendar.epidemic.rows).toHaveLength(24);
    expect(calendar.procedure.items).toHaveLength(15);
    const pages = new Map(calendar.sources.map((source) => [source.eoNumber, source.pagesCount]));
    for (const unit of [
      ...calendar.national.rows,
      ...calendar.epidemic.rows,
      ...calendar.procedure.items,
    ]) {
      expect(unit.source.pdfPages.length, unit.id).toBeGreaterThan(0);
      for (const page of unit.source.pdfPages) {
        expect(page, unit.id).toBeLessThanOrEqual(pages.get(unit.source.eoNumber) ?? 0);
      }
      expect(unit.source.url, unit.id).toContain(`#page=${unit.source.pdfPages[0]}`);
    }
  });

  it('leaves no cell empty', () => {
    for (const row of calendar.national.rows) {
      expect(row.category.trim(), row.id).not.toBe('');
      for (const item of row.items) expect(item.text.trim(), item.id).not.toBe('');
    }
    for (const row of calendar.epidemic.rows) {
      expect(row.vaccine.trim(), row.id).not.toBe('');
      for (const block of row.categories) expect(block.text.trim(), row.id).not.toBe('');
    }
  });

  it('prints the edition line and names the amending order', () => {
    expect(calendar.edition.editionLine).toBe('по приказу № 1122н в ред. приказа № 677н');
    const covid = calendar.epidemic.rows.find((row) => row.target.startsWith('коронавирусной'));
    expect(covid?.amendedBy).toBe('677н');
    expect(covid && sourceOrderNumber(calendar, covid.source)).toBe('677н');
    expect(covid?.previousEdition?.categories[0]?.text).toBe('К приоритету 1-го уровня относятся:');
  });

  it('separates the age rows from the category rows of Appendix 1', () => {
    const ageRows = calendar.national.rows.filter(isAgeRow).map((row) => row.number);
    expect(ageRows).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
  });

  it('structures the wording without changing it', () => {
    const risk = calendar.national.rows[3]?.items[0];
    expect(risk?.text).toBe('Третья вакцинация против вирусного гепатита В (группы риска)');
    expect(risk?.qualifier).toBe('группы риска');
    expect(risk && itemDoseLabel(risk)).toBe('V3');
    const paired = calendar.national.rows[16]?.items[0];
    expect(paired && itemDoseLabel(paired)).toBe('V + RV');
  });

  it('attaches Appendix 3 paragraphs to the infections they are about', () => {
    expect(procedureItemsFor(calendar, 'tuberculosis').map((item) => item.number)).toEqual(['10']);
    expect(procedureItemsFor(calendar, 'hepatitis-b').map((item) => item.number)).toEqual([
      '9',
      '11',
    ]);
    expect(procedureItemsFor(calendar, 'polio').map((item) => item.number)).toEqual(['12', '13']);
    expect(generalProcedureItems(calendar).map((item) => item.number)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  it('labels pages of the official PDF', () => {
    expect(pdfPagesLabel([3])).toBe('стр. 3');
    expect(pdfPagesLabel([4, 5])).toBe('стр. 4–5');
    expect(pdfPagesLabel([])).toBe('');
  });
});
