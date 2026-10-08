import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { filterEpidemicRows } from '@/features/vaccination/vaccination-filter';

describe('epidemic indications search', () => {
  const calendar = getVaccinationCalendar();
  const numbers = (rows: readonly { number: string }[]) => rows.map((row) => row.number);

  it('shows every row for an empty query', () => {
    expect(filterEpidemicRows(calendar.epidemic.rows, '')).toHaveLength(24);
  });

  it('searches by infection and by category wording', () => {
    expect(numbers(filterEpidemicRows(calendar.epidemic.rows, 'клещевой энцефалит'))).toEqual([
      '7',
    ]);
    expect(numbers(filterEpidemicRows(calendar.epidemic.rows, 'ПРИзыву'))).toContain('14');
    expect(filterEpidemicRows(calendar.epidemic.rows, 'нет такого')).toEqual([]);
  });
});
