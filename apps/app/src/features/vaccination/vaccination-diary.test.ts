import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildDiarySheet } from '@/features/vaccination/vaccination-diary';
import {
  renderVaccinationDiaryHtml,
  VACCINATION_DIARY_TITLE,
} from '@/features/vaccination/vaccination-diary-print';

const calendar = getVaccinationCalendar();
const TODAY = '2026-10-07';

function sheetFor(name: string | null, birthDate: string | null) {
  const result = buildDiarySheet(calendar, { name, birthDate }, TODAY);
  if (result.kind !== 'sheet') throw new Error(result.message);
  return result.sheet;
}

describe('personal vaccination diary model', () => {
  it('plans a date for every age column from the birth date', () => {
    const sheet = sheetFor('  Аня  ', '2026-03-15');
    expect(sheet.subject).toEqual({ name: 'Аня', birthDate: '2026-03-15' });
    expect(sheet.dates.get('n-01')).toEqual({ from: '15.03.26', to: null, approximate: false });
    expect(sheet.dates.get('n-02')).toEqual({
      from: '17.03.26',
      to: '21.03.26',
      approximate: true,
    });
    expect(sheet.dates.get('n-06')?.from).toBe('30.07.26');
    // The adult column has no age to count from.
    expect(sheet.dates.has('n-15')).toBe(false);
  });

  it('is the blank chart without a birth date', () => {
    const sheet = sheetFor(null, null);
    expect(sheet.dates.size).toBe(0);
    expect(sheet.subject.name).toBeNull();
  });

  it('reports a birth date the plan cannot use', () => {
    expect(buildDiarySheet(calendar, { name: null, birthDate: '2027-01-01' }, TODAY).kind).toBe(
      'problem',
    );
    expect(buildDiarySheet(calendar, { name: null, birthDate: '1990-01-01' }, TODAY).kind).toBe(
      'problem',
    );
  });
});

describe('personal vaccination diary print', () => {
  it('is one A4 landscape table taken from the chart, with the source of the order', () => {
    const html = renderVaccinationDiaryHtml(calendar, sheetFor('Аня', '2026-03-15'));
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html).toContain(VACCINATION_DIARY_TITLE);
    expect(html).toContain('Национальный календарь профилактических прививок');
    expect(html).toContain('Приказ Минздрава России от 06.12.2021 № 1122н');
    expect(html).toContain('в редакции приказа от 12.12.2023 № 677н');
    expect(html).toContain('приложение № 1');
    expect((html.match(/<th class="vax-diary__infection"/gu) ?? []).length).toBe(12);
    // 15 age columns plus the infection column in the colgroup.
    expect((html.match(/<col[ /]/gu) ?? []).length).toBe(16);
    expect(html).toContain('Аня');
    expect(html).toContain('15.03.2026');
    expect(html).toContain('17.03.26');
  });

  it('gives each dose an empty mark box, except a category dose that names a group', () => {
    const html = renderVaccinationDiaryHtml(calendar, sheetFor(null, null));
    const doses = (html.match(/class="vax-diary__dose[ "]/gu) ?? []).length;
    const marks = (html.match(/class="vax-diary__mark"/gu) ?? []).length;
    expect(doses).toBeGreaterThan(marks);
    expect(marks).toBeGreaterThan(30);
    expect(html).not.toContain('<span class="vax-diary__dose-date">');
  });

  it('carries the legend: V, RV, the bands and the vaccines the order names', () => {
    const html = renderVaccinationDiaryHtml(calendar, sheetFor(null, null));
    for (const text of [
      'вакцинация',
      'ревакцинация',
      'всем',
      'группы риска',
      'ранее не привитым',
      'ИПВ',
      'ОПВ',
      'вакцина для профилактики полиомиелита (инактивированная)',
      'вакцина для профилактики полиомиелита (живая)',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('escapes the name', () => {
    const html = renderVaccinationDiaryHtml(calendar, sheetFor('<img src=x onerror=1>', null));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
