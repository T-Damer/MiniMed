import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildNationalChart } from '@/features/vaccination/vaccination-chart';
import { withMark } from '@/features/vaccination/vaccination-record';
import {
  buildChildCalendar,
  overdueItemIds,
  worstStatus,
} from '@/features/vaccination/vaccination-status';

const calendar = getVaccinationCalendar();
const columnIds = buildNationalChart(calendar).columns.map((column) => column.rowId);

function build(birth: string | null, today: string, marks = {}) {
  return buildChildCalendar(calendar, columnIds, birth, today, marks);
}

describe('child status in the national calendar', () => {
  it('splits unmarked vaccinations into overdue, now and later by the age reached', () => {
    const child = build('2026-01-10', '2026-03-01');
    const status = (id: string) => child.doses.get(id)?.status;
    expect(status('n-01-1')).toBe('overdue');
    expect(status('n-02-1')).toBe('overdue');
    expect(status('n-03-1')).toBe('now');
    expect(status('n-05-1')).toBe('later');
    // A vaccination for risk groups is not due for every child.
    expect(status('n-04-1')).toBe('optional');
    expect(child.counts).toEqual({ done: 0, planned: 0, now: 1, overdue: 2 });
  });

  it('counts a vaccination once however many infections it covers', () => {
    const child = build('2026-01-10', '2026-07-01');
    // DTP (n-05-1) covers three infections but is one vaccination.
    expect([...child.doses.keys()].filter((id) => id === 'n-05-1')).toHaveLength(1);
  });

  it('marks win over the age: done, planned and a planned date that has passed', () => {
    const marks = withMark(
      withMark(withMark({}, 'n-01-1', 'done', '2026-01-11'), 'n-02-1', 'planned', '2026-02-01'),
      'n-03-1',
      'planned',
      '2026-04-01',
    );
    const child = build('2026-01-10', '2026-03-01', marks);
    expect(child.doses.get('n-01-1')?.status).toBe('done');
    expect(child.doses.get('n-02-1')?.status).toBe('overdue');
    expect(child.doses.get('n-03-1')?.status).toBe('planned');
    expect(child.counts).toEqual({ done: 1, planned: 1, now: 0, overdue: 1 });
  });

  it('a marked risk vaccination counts like any other', () => {
    const child = build('2026-01-10', '2026-03-01', withMark({}, 'n-04-1', 'done'));
    expect(child.doses.get('n-04-1')?.status).toBe('done');
    expect(child.counts.done).toBe(1);
  });

  it('leaves the statuses to the marks when there is no usable birth date', () => {
    const withoutDate = build(null, '2026-03-01', withMark({}, 'n-01-1', 'done'));
    expect(withoutDate.doses.get('n-01-1')?.status).toBe('done');
    expect(withoutDate.doses.get('n-03-1')?.status).toBe('later');
    expect(withoutDate.marker).toBeNull();
    expect(withoutDate.timing.size).toBe(0);
    const future = build('2026-03-02', '2026-03-01');
    expect(future.problem).toContain('не может быть позже');
    expect(future.birthDate).toBeNull();
    expect(future.counts).toEqual({ done: 0, planned: 0, now: 0, overdue: 0 });
  });

  it('places today on the age axis between the columns it is between', () => {
    expect(build('2026-03-01', '2026-03-01').marker).toBe(0);
    // n-03 (1 month) starts 2026-02-10 and n-04 (2 months) 2026-03-10; today is 19 of 28 days in.
    expect(build('2026-01-10', '2026-03-01').marker).toBeCloseTo(2 + 19 / 28, 5);
    // Rows that start on the same day (6 years, 6–7 years) put the marker on the later column.
    const sixYears = build('2020-01-10', '2026-01-10').marker;
    expect(sixYears).toBe(columnIds.indexOf('n-13'));
    // Between 14 and 18 years the marker runs toward the adult column.
    const teen = build('2010-01-10', '2026-01-10').marker ?? -1;
    expect(teen).toBeGreaterThan(columnIds.indexOf('n-14'));
    expect(teen).toBeLessThan(columnIds.indexOf('n-15'));
  });

  it('picks the worst status of a cell and lists the overdue vaccinations', () => {
    expect(worstStatus(['done', 'now', 'later'])).toBe('now');
    expect(worstStatus(['optional', 'overdue'])).toBe('overdue');
    expect(worstStatus([])).toBeUndefined();
    const child = build(
      '2026-01-10',
      '2026-03-01',
      withMark({}, 'n-02-1', 'planned', '2026-02-01'),
    );
    // The planned (late) one is not set as done behind the doctor's back.
    expect(overdueItemIds(child)).toEqual(['n-01-1']);
  });
});
