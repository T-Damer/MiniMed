import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar, isAgeRow } from '@/features/vaccination/vaccination-calendar';
import { buildNationalChart } from '@/features/vaccination/vaccination-chart';

describe('chart of the national calendar', () => {
  const calendar = getVaccinationCalendar();
  const chart = buildNationalChart(calendar);
  const cellOf = (key: string, columnId: string) =>
    chart.rows.find((row) => row.key === key)?.cells.get(columnId);
  const labels = (key: string, columnId: string): string[] =>
    (cellOf(key, columnId)?.doses ?? []).map((dose) => dose.label);

  it('has one row per infection of the data, in the order of the data', () => {
    expect(chart.rows.map((row) => row.label)).toEqual([
      'Туберкулёз',
      'Вирусный гепатит B',
      'Пневмококковая инфекция',
      'Коклюш',
      'Дифтерия',
      'Столбняк',
      'Полиомиелит',
      'Гемофильная инфекция',
      'Корь',
      'Краснуха',
      'Эпидемический паротит',
      'Грипп',
    ]);
  });

  it('has one column per age row with compact headers and age groups', () => {
    expect(chart.columns).toHaveLength(15);
    expect(chart.columns.map((column) => column.shortLabel)).toEqual([
      '24 ч',
      '3–7 дн.',
      '1',
      '2',
      '3',
      '4,5',
      '6',
      '12',
      '15',
      '18',
      '20',
      '6',
      '6–7',
      '14',
      '18+',
    ]);
    expect(chart.groups).toEqual([
      { group: 'newborn', span: 2 },
      { group: 'months', span: 9 },
      { group: 'years', span: 3 },
      { group: 'adults', span: 1 },
    ]);
  });

  it('shows a combined vaccine in the row of every infection it covers', () => {
    expect(labels('pertussis', 'n-05')).toEqual(['V1']);
    expect(labels('diphtheria', 'n-05')).toEqual(['V1']);
    expect(labels('tetanus', 'n-05')).toEqual(['V1']);
    // The diphtheria-tetanus vaccine of 6–7 years has no pertussis component.
    expect(labels('diphtheria', 'n-13')).toEqual(['RV2']);
    expect(labels('pertussis', 'n-13')).toEqual([]);
    expect(labels('mumps', 'n-08')).toEqual(['V']);
    expect(labels('measles', 'n-12')).toEqual(['RV']);
  });

  it('places every dose of an age row once per target it covers', () => {
    const expected = calendar.national.rows
      .filter(isAgeRow)
      .flatMap((row) => row.items)
      .reduce((total, item) => total + item.targets.length, 0);
    const placed = chart.rows
      .flatMap((row) => [...row.cells.values()])
      .flatMap((cell) => cell.doses)
      .filter((dose) => !dose.category).length;
    expect(placed).toBe(expected);
  });

  it('colours a dose by the band the data declares', () => {
    expect(cellOf('hepatitis-b', 'n-04')?.doses.map((dose) => [dose.label, dose.band])).toEqual([
      ['V3', 'risk'],
    ]);
    expect(cellOf('tuberculosis', 'n-02')?.doses[0]?.band).toBe('all');
    expect(chart.bands).toEqual(['all', 'risk', 'catch-up']);
  });

  it('runs a category row from its first age on into adulthood, with the dose in the first column', () => {
    const coveredAs = (band: string) =>
      chart.columns
        .filter((column) => cellOf('influenza', column.rowId)?.covered === band)
        .map((column) => column.rowId);
    // Row 19 is for every child from 6 months (green) and for named groups of adults.
    expect(coveredAs('all')).toEqual([
      'n-07',
      'n-08',
      'n-09',
      'n-10',
      'n-11',
      'n-12',
      'n-13',
      'n-14',
    ]);
    expect(coveredAs('risk')).toEqual(['n-15']);
    expect(cellOf('influenza', 'n-07')?.doses[0]?.band).toBe('all');
    expect(cellOf('influenza', 'n-07')?.doses.map((dose) => dose.category)).toEqual([true]);
    expect(cellOf('influenza', 'n-08')?.doses).toEqual([]);
    expect(cellOf('measles', 'n-07')?.covered).toBeNull();
    expect(cellOf('measles', 'n-08')?.covered).toBe('catch-up');
    expect(labels('measles', 'n-08')).toEqual(['V', 'V + RV']);
  });

  it('names the vaccine of polio steps from the order, with the risk-group variant', () => {
    const product = (id: string) => cellOf('polio', id)?.doses[0]?.product;
    expect(product('n-05')?.code).toBe('ИПВ');
    expect(product('n-10')?.code).toBe('ИПВ');
    expect(product('n-11')).toMatchObject({ code: 'ОПВ', riskCode: 'ИПВ', procedureNumber: '12' });
    expect(chart.products.map((entry) => entry.code).sort()).toEqual(['ИПВ', 'ОПВ']);
  });
});
