import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  DEFAULT_FILTER,
  filterEpidemicRows,
  filterNationalRows,
} from '@/features/vaccination/vaccination-filter';

describe('calendar filters', () => {
  const calendar = getVaccinationCalendar();
  const numbers = (rows: readonly { number: string }[]) => rows.map((row) => row.number);

  it('shows every row by default', () => {
    expect(filterNationalRows(calendar.national.rows, DEFAULT_FILTER)).toHaveLength(19);
    expect(filterEpidemicRows(calendar.epidemic.rows, DEFAULT_FILTER)).toHaveLength(24);
  });

  it('children keep the child rows and the rows that name both; adults keep the adult rows', () => {
    const children = filterNationalRows(calendar.national.rows, {
      ...DEFAULT_FILTER,
      population: 'children',
    });
    expect(numbers(children)).toEqual([
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
      '16',
      '17',
      '18',
      '19',
    ]);
    const adults = filterNationalRows(calendar.national.rows, {
      ...DEFAULT_FILTER,
      population: 'adults',
    });
    expect(numbers(adults)).toEqual(['15', '16', '17', '18', '19']);
  });

  it('an age keeps its row and never hides a category row', () => {
    const rows = filterNationalRows(calendar.national.rows, { ...DEFAULT_FILTER, age: 'n-05' });
    expect(numbers(rows)).toEqual(['5', '16', '17', '18', '19']);
    const adult = filterNationalRows(calendar.national.rows, { ...DEFAULT_FILTER, age: 'n-15' });
    expect(numbers(adult)).toEqual(['15', '16', '17', '18', '19']);
  });

  it('searches the epidemic rows by infection and by category wording', () => {
    const tick = filterEpidemicRows(calendar.epidemic.rows, {
      ...DEFAULT_FILTER,
      query: 'клещевой энцефалит',
    });
    expect(numbers(tick)).toEqual(['7']);
    const border = filterEpidemicRows(calendar.epidemic.rows, {
      ...DEFAULT_FILTER,
      query: 'ПРИзыву',
    });
    expect(numbers(border)).toContain('14');
    expect(
      filterEpidemicRows(calendar.epidemic.rows, { ...DEFAULT_FILTER, query: 'нет такого' }),
    ).toEqual([]);
  });

  it('filters the epidemic rows by population', () => {
    const children = filterEpidemicRows(calendar.epidemic.rows, {
      ...DEFAULT_FILTER,
      population: 'children',
    });
    expect(numbers(children)).toContain('21');
    expect(numbers(children)).not.toContain('24');
    const adults = filterEpidemicRows(calendar.epidemic.rows, {
      ...DEFAULT_FILTER,
      population: 'adults',
    });
    expect(numbers(adults)).toContain('24');
    expect(numbers(adults)).not.toContain('21');
  });
});
