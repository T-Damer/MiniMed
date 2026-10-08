import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildNationalChart } from '@/features/vaccination/vaccination-chart';
import { buildHandout } from '@/features/vaccination/vaccination-handout';
import { renderVaccinationHandoutHtml } from '@/features/vaccination/vaccination-handout-print';
import { withMark } from '@/features/vaccination/vaccination-record';

const calendar = getVaccinationCalendar();
const columnIds = buildNationalChart(calendar).columns.map((column) => column.rowId);

describe('handout for the mother', () => {
  const marks = withMark(
    withMark({}, 'n-01-1', 'done', '2025-03-16'),
    'n-03-1',
    'planned',
    '2026-12-01',
  );
  const handout = buildHandout(
    calendar,
    columnIds,
    { name: 'Анна <Иванова>', birthDate: '2025-03-15' },
    marks,
    '2026-10-08',
  );
  const html = renderVaccinationHandoutHtml(handout);

  it('has a row for every age and says the child is 1 year 6 months', () => {
    expect(handout.rows).toHaveLength(15);
    expect(handout.ageText).toBe('1 год 6 мес.');
    expect(handout.rows[0]).toMatchObject({ age: 'Первые 24 часа', when: '15.03.2025' });
    // 4,5 months is four months and fifteen days: the date is approximate.
    expect(handout.rows.find((row) => row.rowId === 'n-06')?.when).toBe('≈ 30.07.2025');
    expect(handout.rows.find((row) => row.rowId === 'n-13')?.when).toBe(
      '≈ 15.03.2031 — 15.03.2032',
    );
  });

  it('describes a vaccination in plain words and carries the marks', () => {
    const first = handout.rows[0]?.doses[0];
    expect(first).toEqual({
      text: 'Вирусный гепатит В — 1-я прививка',
      status: 'done',
      noted: '16.03.2025',
    });
    const dtp = handout.rows.find((row) => row.rowId === 'n-05')?.doses[0];
    expect(dtp?.text).toBe('Дифтерия, коклюш, столбняк — 1-я прививка');
    const polio = handout.rows.find((row) => row.rowId === 'n-11')?.doses[0];
    expect(polio?.text).toBe('Полиомиелит — 2-я повторная прививка (ОПВ)');
    const risk = handout.rows.find((row) => row.rowId === 'n-04')?.doses[0];
    expect(risk?.text).toContain('для групп риска');
    expect(risk?.status).toBe('optional');
    expect(handout.rows.find((row) => row.rowId === 'n-03')?.doses[0]?.status).toBe('planned');
  });

  it('prints one A4 portrait page with no legal wording and escapes the name', () => {
    expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(html).toContain('Анна &lt;Иванова&gt;');
    expect(html).not.toContain('<Иванова>');
    expect(html).toContain('сделана 16.03.2025');
    expect(html).toContain('запланирована 01.12.2026');
    expect(html).toContain('нужно сделать');
    expect(html).toContain('Распечатано 08.10.2026');
    expect(html).not.toContain('клинич');
    expect(html).not.toContain('<script');
  });

  it('is a blank sheet with empty date lines when nothing is known', () => {
    const blank = buildHandout(
      calendar,
      columnIds,
      { name: null, birthDate: null },
      {},
      '2026-10-08',
    );
    expect(blank.rows.every((row) => row.when === '')).toBe(true);
    expect(blank.ageText).toBe('');
    const blankHtml = renderVaccinationHandoutHtml(blank);
    expect(blankHtml).toContain('handout__blank');
    expect(blankHtml).not.toContain('нужно сделать');
  });
});
