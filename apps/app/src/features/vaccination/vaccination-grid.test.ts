import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildSummaryGrid, gridDoseCount } from '@/features/vaccination/vaccination-grid';

describe('summary grid of the national calendar', () => {
  const calendar = getVaccinationCalendar();
  const grid = buildSummaryGrid(calendar);

  it('has one column per age row and keeps the category rows apart', () => {
    expect(grid.columns).toHaveLength(15);
    expect(grid.columns[0]?.label).toBe('Первые 24 часа');
    expect(grid.categoryRows.map((row) => row.number)).toEqual(['16', '17', '18', '19']);
  });

  it('lists the infections in the order they first appear', () => {
    expect(grid.rows.map((row) => row.infectionKey)).toEqual([
      'hepatitis-b',
      'tuberculosis',
      'pneumococcal',
      'dtp',
      'polio',
      'hib',
      'mmr',
      'dt',
    ]);
  });

  it('puts every vaccination of an age row into the grid exactly once', () => {
    const items = calendar.national.rows
      .filter((row) => row.age !== null || row.population === 'adults')
      .reduce((total, row) => total + row.items.length, 0);
    expect(gridDoseCount(grid)).toBe(items);
    expect(items).toBe(29);
  });

  it('shows the hepatitis B series with its risk-group doses marked', () => {
    const hepatitis = grid.rows.find((row) => row.infectionKey === 'hepatitis-b');
    const byColumn = (rowId: string) =>
      hepatitis?.cells.get(rowId)?.map((dose) => `${dose.label}${dose.qualifier ? '*' : ''}`);
    expect(byColumn('n-01')).toEqual(['V1']);
    expect(byColumn('n-03')).toEqual(['V2']);
    expect(byColumn('n-04')).toEqual(['V3*']);
    expect(byColumn('n-07')).toEqual(['V3']);
    expect(byColumn('n-08')).toEqual(['V4*']);
  });

  it('keeps the condition of the adult revaccination', () => {
    const dt = grid.rows.find((row) => row.infectionKey === 'dt');
    const adult = dt?.cells.get('n-15')?.[0];
    expect(adult?.label).toBe('RV');
    expect(adult?.condition).toBe('каждые 10 лет от момента последней ревакцинации');
  });

  it('follows the rows it is given', () => {
    const only = buildSummaryGrid({
      ...calendar,
      national: {
        ...calendar.national,
        rows: calendar.national.rows.filter((row) => row.id === 'n-05'),
      },
    });
    expect(only.columns.map((column) => column.rowId)).toEqual(['n-05']);
    expect(only.rows.map((row) => row.infectionKey)).toEqual(['dtp', 'polio', 'hib']);
    expect(only.categoryRows).toEqual([]);
  });
});
