import { describe, expect, it } from 'vitest';

import {
  calculateBishopScore,
  calculateEddByConception,
  calculateEddByLmp,
  calculateEddByQuickening,
  calculateEddByUltrasound,
  calculateEddForGivenDate,
  calculateGestationalAgeByBiometry,
  calculateGestationalAgeByCrl,
  calculateGestationalAgeFromEdd,
  calculateMaternityLeaveTimeframe,
} from '@/features/calculators/obstetric-calculations';

function formatRuDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

describe('obstetric calculations', () => {
  it('calculates EDD by LMP as Naegele LMP + 280 days', () => {
    const result = calculateEddByLmp({ lmpDate: '2026-01-01' });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    const expected = formatRuDate(addDays(new Date('2026-01-01T00:00:00'), 280));
    expect(result.textValues[0]?.text).toBe(expected);
  });

  it('rejects an empty or invalid LMP date', () => {
    expect(calculateEddByLmp({ lmpDate: '' }).ok).toBe(false);
    expect(calculateEddByLmp({ lmpDate: 'not-a-date' }).ok).toBe(false);
  });

  it('calculates EDD by ultrasound as exam date + remaining days to 280', () => {
    const result = calculateEddByUltrasound({ examDate: '2026-03-01', gaWeeks: 12, gaDays: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    const expected = formatRuDate(addDays(new Date('2026-03-01T00:00:00'), 280 - 84));
    expect(result.textValues[0]?.text).toBe(expected);
  });

  it('rejects a gestational age at exam beyond 40 weeks', () => {
    const result = calculateEddByUltrasound({ examDate: '2026-03-01', gaWeeks: 41, gaDays: 0 });
    expect(result.ok).toBe(false);
  });

  it('calculates EDD by conception as conception date + 266 days', () => {
    const result = calculateEddByConception({ conceptionDate: '2026-01-01' });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    const expected = formatRuDate(addDays(new Date('2026-01-01T00:00:00'), 266));
    expect(result.textValues[0]?.text).toBe(expected);
  });

  it('adds 22 weeks for primigravida and 24 weeks for multigravida quickening', () => {
    const primi = calculateEddByQuickening({
      quickeningDate: '2026-01-01',
      parity: 'primigravida',
    });
    const multi = calculateEddByQuickening({
      quickeningDate: '2026-01-01',
      parity: 'multigravida',
    });
    expect(primi.ok).toBe(true);
    expect(multi.ok).toBe(true);
    if (!primi.ok || !multi.ok || !('textValues' in primi) || !('textValues' in multi)) {
      throw new Error('expected text results');
    }
    expect(primi.textValues[0]?.text).toBe(
      formatRuDate(addDays(new Date('2026-01-01T00:00:00'), 22 * 7)),
    );
    expect(multi.textValues[0]?.text).toBe(
      formatRuDate(addDays(new Date('2026-01-01T00:00:00'), 24 * 7)),
    );
  });

  it('calculates EDD for a given date the same way as by ultrasound', () => {
    const result = calculateEddForGivenDate({
      referenceDate: '2026-03-01',
      gaWeeks: 12,
      gaDays: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    const expected = formatRuDate(addDays(new Date('2026-03-01T00:00:00'), 280 - 84));
    expect(result.textValues[0]?.text).toBe(expected);
  });

  it('computes gestational age from EDD as weeks and days', () => {
    const result = calculateGestationalAgeFromEdd({
      eddDate: '2026-12-01',
      asOfDate: '2026-09-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('values' in result)) throw new Error('expected numeric result');
    const weeks = result.values.find((item) => item.label === 'Недели');
    const days = result.values.find((item) => item.label === 'Дни');
    expect(weeks?.value).toBe(27);
    expect(days?.value).toBe(0);
  });

  it('rejects an as-of date before the implied start of pregnancy', () => {
    const result = calculateGestationalAgeFromEdd({
      eddDate: '2026-12-01',
      asOfDate: '2026-01-01',
    });
    expect(result.ok).toBe(false);
  });

  it('starts singleton maternity leave at 30 weeks from the implied LMP for 140 days', () => {
    const result = calculateMaternityLeaveTimeframe({
      eddDate: '2026-12-01',
      pregnancyType: 'single',
      complicatedBirth: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    const impliedLmp = addDays(new Date('2026-12-01T00:00:00'), -280);
    const expectedStart = formatRuDate(addDays(impliedLmp, 30 * 7));
    const expectedEnd = formatRuDate(addDays(addDays(impliedLmp, 30 * 7), 139));
    expect(result.textValues[0]?.text).toBe(expectedStart);
    expect(result.textValues[1]?.text).toBe(expectedEnd);
    expect(result.textValues[2]?.text).toBe('140 календарных дней');
  });

  it('grants 194 days from 28 weeks for a multiple pregnancy', () => {
    const result = calculateMaternityLeaveTimeframe({
      eddDate: '2026-12-01',
      pregnancyType: 'multiple',
      complicatedBirth: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    expect(result.textValues[2]?.text).toBe('194 календарных дней');
  });

  it('extends singleton leave to 156 days for a complicated birth', () => {
    const result = calculateMaternityLeaveTimeframe({
      eddDate: '2026-12-01',
      pregnancyType: 'single',
      complicatedBirth: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('textValues' in result)) throw new Error('expected text result');
    expect(result.textValues[2]?.text).toBe('156 календарных дней');
  });

  it('calculates gestational age by CRL using the Robinson-Fleming formula', () => {
    const result = calculateGestationalAgeByCrl({ crlMm: 45 });
    expect(result.ok).toBe(true);
    if (!result.ok || !('values' in result)) throw new Error('expected numeric result');
    const expectedDays = Math.round(8.052 * Math.sqrt(45) + 23.73);
    const weeks = result.values.find((item) => item.label === 'Недели');
    const days = result.values.find((item) => item.label === 'Дни');
    expect(weeks?.value).toBe(Math.floor(expectedDays / 7));
    expect(days?.value).toBe(expectedDays % 7);
  });

  it('rejects a CRL outside the first-trimester validity range', () => {
    expect(calculateGestationalAgeByCrl({ crlMm: 5 }).ok).toBe(false);
    expect(calculateGestationalAgeByCrl({ crlMm: 120 }).ok).toBe(false);
  });

  it('averages the Hadlock single-parameter estimates for biometry', () => {
    const bpdOnly = calculateGestationalAgeByBiometry({ bpdCm: 5 });
    expect(bpdOnly.ok).toBe(true);
    if (!bpdOnly.ok || !('values' in bpdOnly)) throw new Error('expected numeric result');
    const expectedWeeks = 9.54 + 1.482 * 5 + 0.1676 * 5 ** 2;
    const expectedDays = Math.round(expectedWeeks * 7);
    const weeks = bpdOnly.values.find((item) => item.label === 'Недели');
    const days = bpdOnly.values.find((item) => item.label === 'Дни');
    expect(weeks?.value).toBe(Math.floor(expectedDays / 7));
    expect(days?.value).toBe(expectedDays % 7);
  });

  it('rejects biometry input with no parameters provided', () => {
    expect(calculateGestationalAgeByBiometry({}).ok).toBe(false);
  });

  it('sums the five Bishop score criteria', () => {
    const result = calculateBishopScore({
      dilationScore: 2,
      effacementScore: 2,
      stationScore: 1,
      consistencyScore: 1,
      positionScore: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('value' in result)) throw new Error('expected numeric result');
    expect(result.value).toBe(7);
    expect(result.unit).toBe('баллов');
  });

  it('rejects an out-of-range Bishop criterion', () => {
    const result = calculateBishopScore({
      dilationScore: 4,
      effacementScore: 0,
      stationScore: 0,
      consistencyScore: 0,
      positionScore: 0,
    });
    expect(result.ok).toBe(false);
  });
});
