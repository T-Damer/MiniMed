import { describe, expect, it } from 'vitest';

import { loadSickLeaveData } from '@/features/sick-leave/sick-leave-data';
import raw from '@/features/sick-leave/sick-leave-periods.json?raw';

interface RawAsset {
  readonly provenance: readonly (readonly [number, string])[];
  readonly valueCorrections: readonly (readonly [string, string, string, string])[];
  readonly entries: readonly unknown[];
}

const asset = JSON.parse(raw) as RawAsset;

/** «9 - 11», «4 - 5 мес.», «35 - 50, МСЭ», «5», «90 - 130, возможно МСЭ». */
const PERIOD = /^(\d+(?:,\d)?)(?: - (\d+(?:,\d)?))?( мес\.)?(?:,? (?:возможно )?МСЭ)?$/u;

describe('sick-leave asset rows', () => {
  it('has a code, a title and at least one period for every row', async () => {
    const data = await loadSickLeaveData();
    for (const [code, title, , , periods] of data.entries) {
      expect(code, title).toMatch(
        /^[A-Z]\d{2}(?:\.\d){0,2}$|^[A-Z]\d{2}\.-$|^[A-Z]\d{2}-[A-Z]\d{2}$/u,
      );
      expect(title.length, code).toBeGreaterThanOrEqual(3);
      expect(
        periods.some((period) => period[1] !== ''),
        code,
      ).toBe(true);
    }
  });

  it('keeps min <= max in every period and a plausible magnitude', async () => {
    const data = await loadSickLeaveData();
    let periodCount = 0;
    for (const [code, , , , periods] of data.entries) {
      for (const [features, text] of periods) {
        if (text === '') continue;
        const match = PERIOD.exec(text);
        expect(match, `${code} ${features}: «${text}»`).not.toBeNull();
        const min = Number((match?.[1] ?? '').replace(',', '.'));
        const max = match?.[2] === undefined ? min : Number(match[2].replace(',', '.'));
        expect(min, `${code} ${text}`).toBeLessThanOrEqual(max);
        expect(min, `${code} ${text}`).toBeGreaterThan(0);
        const months = match?.[3] !== undefined;
        expect(max, `${code} ${text}`).toBeLessThanOrEqual(months ? 36 : 400);
        periodCount += 1;
      }
    }
    expect(periodCount).toBeGreaterThan(1300);
  });

  it('names its source row (table of the letter and form line) for every entry', async () => {
    const data = await loadSickLeaveData();
    expect(asset.provenance).toHaveLength(data.entries.length);
    const withoutFormLine: string[] = [];
    for (const [index, [table, lines]] of asset.provenance.entries()) {
      const code = String(data.entries[index]?.[0]);
      expect(Number.isInteger(table), code).toBe(true);
      expect(table).toBeGreaterThanOrEqual(1);
      expect(table).toBeLessThanOrEqual(16);
      if (lines === '') withoutFormLine.push(code);
      else expect(lines, code).toMatch(/^\d{1,2}(?:, \d{1,2})*$/u);
    }
    // The letter itself leaves the form-line cell empty for these three rows (all four copies).
    expect(withoutFormLine).toEqual(['D65', 'H43.1', 'L40.1']);
  });

  it('records each corrected value with its printed form and basis', async () => {
    const data = await loadSickLeaveData();
    expect(asset.valueCorrections.length).toBeGreaterThan(0);
    for (const [code, printed, period, basis] of asset.valueCorrections) {
      expect(basis.length).toBeGreaterThan(20);
      expect(printed).not.toBe(period);
      const periods = data.entries
        .filter((entry) => entry[0] === code)
        .flatMap((entry) => entry[4].map((item) => item[1]));
      expect(periods).toContain(period);
      expect(periods).not.toContain(printed);
    }
  });

  it('carries the values settled against the second copies of the letter (2026-10-13)', async () => {
    const data = await loadSickLeaveData();
    const periodsOf = (code: string): string[] =>
      data.entries
        .filter((entry) => entry[0] === code)
        .flatMap((entry) => entry[4].map((item) => item[1]));
    expect(periodsOf('A01.0')).toEqual(['35 - 45']);
    expect(periodsOf('H44.0')).toEqual(['25 - 35']);
    // Impossible in the MedSolutions/Kodeks copy («15-10», «17-10»).
    expect(periodsOf('H00.1')).toEqual(['5 - 10', '7 - 14']);
    expect(periodsOf('L60.0')).toEqual(['7 - 10']);
    // The letter prints two lines for Itsenko-Cushing (operation), not one merged range.
    expect(periodsOf('E24.0')).toEqual(['30 - 55', '50 - 60']);
    expect(periodsOf('S52.2.0')).toEqual(['60 - 90', '45 - 50']);
    expect(periodsOf('S52.2.1')).toEqual(['60 - 65', '45 - 55']);
    expect(data.entries.filter((entry) => entry[0] === 'S82.2.1')).toHaveLength(2);
  });
});
