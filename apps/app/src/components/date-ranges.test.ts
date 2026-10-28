import { describe, expect, it } from 'vitest';

import {
  addDay,
  addDays,
  addRange,
  countDays,
  dayNumber,
  describeRanges,
  localDayKey,
  normalizeRanges,
  pluralDays,
  presetRange,
  rangesContain,
  removeDay,
  toggleDay,
} from './date-ranges';

describe('day arithmetic', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-27', 5)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects malformed and impossible keys', () => {
    expect(dayNumber('2026-02-30')).toBeNaN();
    expect(dayNumber('27.10.2026')).toBeNaN();
    expect(dayNumber('2026-10-27')).not.toBeNaN();
  });

  it('formats a local day key', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('normalizeRanges', () => {
  it('sorts, swaps reversed ends and merges overlapping and adjacent ranges', () => {
    expect(
      normalizeRanges([
        { from: '2026-11-10', to: '2026-11-12' },
        { from: '2026-11-05', to: '2026-11-01' },
        { from: '2026-11-06', to: '2026-11-08' },
        { from: '2026-11-02', to: '2026-11-03' },
      ]),
    ).toEqual([
      { from: '2026-11-01', to: '2026-11-08' },
      { from: '2026-11-10', to: '2026-11-12' },
    ]);
  });

  it('keeps a range swallowed by a longer one inside it', () => {
    expect(
      normalizeRanges([
        { from: '2026-11-01', to: '2026-11-30' },
        { from: '2026-11-05', to: '2026-11-06' },
      ]),
    ).toEqual([{ from: '2026-11-01', to: '2026-11-30' }]);
  });

  it('drops malformed ranges', () => {
    expect(normalizeRanges([{ from: 'x', to: '2026-11-01' }])).toEqual([]);
  });
});

describe('editing', () => {
  const course = [{ from: '2026-11-01', to: '2026-11-05' }];

  it('adds a range from two taps in either order', () => {
    expect(addRange([], '2026-11-09', '2026-11-07')).toEqual([
      { from: '2026-11-07', to: '2026-11-09' },
    ]);
  });

  it('merges a new range that touches an existing one', () => {
    expect(addRange(course, '2026-11-06', '2026-11-08')).toEqual([
      { from: '2026-11-01', to: '2026-11-08' },
    ]);
  });

  it('adds a single free day', () => {
    expect(addDay(course, '2026-11-10')).toEqual([
      { from: '2026-11-01', to: '2026-11-05' },
      { from: '2026-11-10', to: '2026-11-10' },
    ]);
  });

  it('splits a range when a day inside is removed', () => {
    expect(removeDay(course, '2026-11-03')).toEqual([
      { from: '2026-11-01', to: '2026-11-02' },
      { from: '2026-11-04', to: '2026-11-05' },
    ]);
  });

  it('shrinks a range at its ends and deletes a one-day range', () => {
    expect(removeDay(course, '2026-11-01')).toEqual([{ from: '2026-11-02', to: '2026-11-05' }]);
    expect(removeDay(course, '2026-11-05')).toEqual([{ from: '2026-11-01', to: '2026-11-04' }]);
    expect(removeDay([{ from: '2026-11-01', to: '2026-11-01' }], '2026-11-01')).toEqual([]);
  });

  it('ignores removing a day that is not selected', () => {
    expect(removeDay(course, '2026-11-20')).toEqual(course);
  });

  it('toggles a day on and off', () => {
    const on = toggleDay([], '2026-11-04');
    expect(rangesContain(on, '2026-11-04')).toBe(true);
    expect(toggleDay(on, '2026-11-04')).toEqual([]);
  });
});

describe('queries', () => {
  const ranges = [
    { from: '2026-10-27', to: '2026-11-09' },
    { from: '2026-11-15', to: '2026-11-15' },
  ];

  it('contains the ends and the days between, not the gaps', () => {
    expect(rangesContain(ranges, '2026-10-27')).toBe(true);
    expect(rangesContain(ranges, '2026-11-09')).toBe(true);
    expect(rangesContain(ranges, '2026-11-10')).toBe(false);
    expect(rangesContain(ranges, '2026-11-15')).toBe(true);
  });

  it('counts distinct days, ends included', () => {
    expect(countDays(ranges)).toBe(15);
    expect(countDays([])).toBe(0);
    expect(
      countDays([
        { from: '2026-11-01', to: '2026-11-03' },
        { from: '2026-11-02', to: '2026-11-04' },
      ]),
    ).toBe(4);
  });
});

describe('presetRange', () => {
  it('counts the start day as the first day', () => {
    expect(presetRange('2026-10-27', 7)).toEqual([{ from: '2026-10-27', to: '2026-11-02' }]);
    expect(countDays(presetRange('2026-10-27', 30))).toBe(30);
    expect(presetRange('2026-10-27', 1)).toEqual([{ from: '2026-10-27', to: '2026-10-27' }]);
  });

  it('is empty for a bad start or length', () => {
    expect(presetRange('nope', 7)).toEqual([]);
    expect(presetRange('2026-10-27', 0)).toEqual([]);
  });
});

describe('pluralDays', () => {
  it.each([
    [1, 'день'],
    [2, 'дня'],
    [4, 'дня'],
    [5, 'дней'],
    [11, 'дней'],
    [12, 'дней'],
    [14, 'дней'],
    [21, 'день'],
    [22, 'дня'],
    [25, 'дней'],
    [100, 'дней'],
    [101, 'день'],
    [111, 'дней'],
  ])('%i -> %s', (count, word) => {
    expect(pluralDays(count)).toBe(word);
  });
});

describe('describeRanges', () => {
  it('says «Без срока» for nothing', () => {
    expect(describeRanges([])).toBe('Без срока');
  });

  it('describes one range with its length', () => {
    expect(describeRanges([{ from: '2026-10-27', to: '2026-11-09' }])).toBe(
      '27 окт. – 9 нояб. · 14 дней',
    );
  });

  it('describes a single day', () => {
    expect(describeRanges([{ from: '2026-11-09', to: '2026-11-09' }])).toBe('9 нояб. · 1 день');
  });

  it('joins several ranges and totals them', () => {
    expect(
      describeRanges([
        { from: '2026-11-15', to: '2026-11-15' },
        { from: '2026-10-27', to: '2026-10-29' },
      ]),
    ).toBe('27 – 29 окт., 15 нояб. · 4 дня');
  });

  it('names the month once when a range stays inside it', () => {
    expect(describeRanges([{ from: '2026-11-03', to: '2026-11-09' }])).toBe('3 – 9 нояб. · 7 дней');
  });

  it('names both years when a range crosses New Year', () => {
    expect(describeRanges([{ from: '2026-12-30', to: '2027-01-02' }])).toBe(
      '30 дек. 2026 – 2 янв. 2027 · 4 дня',
    );
  });
});
