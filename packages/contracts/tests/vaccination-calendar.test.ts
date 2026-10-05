import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseVaccinationCalendar, VaccinationCalendarSchema } from '../src/vaccination-calendar';

function committed(): Record<string, unknown> {
  const url = new URL(
    '../../../apps/app/src/features/vaccination/data/ru-minzdrav-1122n.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('vaccination calendar contract', () => {
  it('accepts the committed transcription of order 1122н', () => {
    const calendar = parseVaccinationCalendar(committed());
    expect(calendar.national.rows).toHaveLength(19);
    expect(calendar.epidemic.rows).toHaveLength(24);
    expect(calendar.procedure.items).toHaveLength(15);
    expect(calendar.edition.editionLine).toBe('по приказу № 1122н в ред. приказа № 677н');
  });

  it('rejects an empty cell', () => {
    const data = clone(committed()) as { national: { rows: { items: { text: string }[] }[] } };
    must(must(data.national.rows[0]).items[0]).text = '  ';
    expect(VaccinationCalendarSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a row without a source page', () => {
    const data = clone(committed()) as { epidemic: { rows: { source: { pdfPages: number[] } }[] } };
    must(data.epidemic.rows[0]).source.pdfPages = [];
    expect(VaccinationCalendarSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a page beyond the official file and a link to another file', () => {
    const beyond = clone(committed()) as {
      procedure: { items: { source: { pdfPages: number[] } }[] };
    };
    must(beyond.procedure.items[0]).source.pdfPages = [99];
    expect(VaccinationCalendarSchema.safeParse(beyond).success).toBe(false);

    const foreign = clone(committed()) as { national: { rows: { source: { url: string } }[] } };
    must(foreign.national.rows[0]).source.url =
      'http://publication.pravo.gov.ru/file/pdf?eoNumber=1#page=1';
    expect(VaccinationCalendarSchema.safeParse(foreign).success).toBe(false);
  });

  it('rejects a duplicated row id and an unknown field', () => {
    const duplicated = clone(committed()) as { national: { rows: { id: string }[] } };
    must(duplicated.national.rows[1]).id = must(duplicated.national.rows[0]).id;
    expect(VaccinationCalendarSchema.safeParse(duplicated).success).toBe(false);

    const extra = { ...committed(), invented: true };
    expect(VaccinationCalendarSchema.safeParse(extra).success).toBe(false);
  });
});
