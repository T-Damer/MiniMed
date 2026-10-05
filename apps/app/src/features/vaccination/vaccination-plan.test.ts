import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  addAgeMonths,
  addDays,
  addMonths,
  buildChildPlan,
  daysBetween,
  formatIsoDate,
  parseIsoDate,
} from '@/features/vaccination/vaccination-plan';

function date(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(value);
  return parsed;
}

describe('calendar date arithmetic', () => {
  it('parses only real calendar dates', () => {
    expect(parseIsoDate('2026-02-29')).toBeUndefined();
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseIsoDate('29.02.2024')).toBeUndefined();
    expect(parseIsoDate('')).toBeUndefined();
  });

  it('adds calendar months and clamps to the last day of a short month', () => {
    expect(formatIsoDate(addMonths(date('2026-01-31'), 1))).toBe('2026-02-28');
    expect(formatIsoDate(addMonths(date('2024-01-31'), 1))).toBe('2024-02-29');
    expect(formatIsoDate(addMonths(date('2026-11-30'), 3))).toBe('2027-02-28');
    expect(formatIsoDate(addMonths(date('2026-05-15'), 12))).toBe('2027-05-15');
  });

  it('counts the half month as fifteen days', () => {
    expect(formatIsoDate(addAgeMonths(date('2026-01-10'), 4.5))).toBe('2026-05-25');
    expect(formatIsoDate(addAgeMonths(date('2026-01-10'), 6))).toBe('2026-07-10');
  });

  it('adds days across month and year ends', () => {
    expect(formatIsoDate(addDays(date('2026-12-30'), 3))).toBe('2027-01-02');
    expect(daysBetween(date('2026-01-01'), date('2026-03-01'))).toBe(59);
  });
});

describe('child plan', () => {
  const rows = getVaccinationCalendar().national.rows;

  it('dates the age rows from the birth date', () => {
    const plan = buildChildPlan(rows, '2026-01-10', '2026-03-01');
    if (plan.kind !== 'plan') throw new Error('expected a plan');
    const byRow = new Map(plan.entries.map((entry) => [entry.rowId, entry]));
    expect(plan.entries).toHaveLength(14);
    expect(formatIsoDate(byRow.get('n-01')?.from ?? date('2000-01-01'))).toBe('2026-01-10');
    expect(formatIsoDate(byRow.get('n-02')?.from ?? date('2000-01-01'))).toBe('2026-01-12');
    expect(formatIsoDate(byRow.get('n-02')?.to ?? date('2000-01-01'))).toBe('2026-01-16');
    expect(formatIsoDate(byRow.get('n-03')?.from ?? date('2000-01-01'))).toBe('2026-02-10');
    expect(formatIsoDate(byRow.get('n-06')?.from ?? date('2000-01-01'))).toBe('2026-05-25');
    expect(formatIsoDate(byRow.get('n-12')?.from ?? date('2000-01-01'))).toBe('2032-01-10');
    expect(formatIsoDate(byRow.get('n-13')?.to ?? date('2000-01-01'))).toBe('2033-01-10');
    expect(formatIsoDate(byRow.get('n-14')?.from ?? date('2000-01-01'))).toBe('2040-01-10');
  });

  it('marks a date that rests on a convention as approximate', () => {
    const plan = buildChildPlan(rows, '2026-01-10', '2026-03-01');
    if (plan.kind !== 'plan') throw new Error('expected a plan');
    const approximate = plan.entries
      .filter((entry) => entry.approximate)
      .map((entry) => entry.number);
    expect(approximate).toEqual(['2', '6', '13']);
  });

  it('marks the latest age reached and the rest as passed or upcoming', () => {
    const plan = buildChildPlan(rows, '2026-01-10', '2026-03-01');
    if (plan.kind !== 'plan') throw new Error('expected a plan');
    const statuses = plan.entries.map((entry) => `${entry.number}:${entry.status}`);
    expect(statuses.slice(0, 5)).toEqual([
      '1:passed',
      '2:passed',
      '3:current',
      '4:upcoming',
      '5:upcoming',
    ]);
    expect(plan.entries.filter((entry) => entry.status === 'current')).toHaveLength(1);
  });

  it('on the birth date only the first row has been reached', () => {
    const plan = buildChildPlan(rows, '2026-03-01', '2026-03-01');
    if (plan.kind !== 'plan') throw new Error('expected a plan');
    expect(plan.entries[0]?.status).toBe('current');
    expect(plan.entries.slice(1).every((entry) => entry.status === 'upcoming')).toBe(true);
  });

  it('refuses a missing, impossible, future or adult birth date', () => {
    expect(buildChildPlan(rows, 'вчера', '2026-03-01')).toEqual({
      kind: 'problem',
      problem: 'invalid-date',
    });
    expect(buildChildPlan(rows, '2026-02-30', '2026-03-01')).toEqual({
      kind: 'problem',
      problem: 'invalid-date',
    });
    expect(buildChildPlan(rows, '2026-03-02', '2026-03-01')).toEqual({
      kind: 'problem',
      problem: 'future-date',
    });
    expect(buildChildPlan(rows, '2000-03-01', '2026-03-01')).toEqual({
      kind: 'problem',
      problem: 'adult',
    });
    expect(buildChildPlan(rows, '2008-03-02', '2026-03-01').kind).toBe('plan');
  });
});
