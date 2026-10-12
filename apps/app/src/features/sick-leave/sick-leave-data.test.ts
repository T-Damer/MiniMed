import { describe, expect, it } from 'vitest';

import {
  loadSickLeaveData,
  parseSickLeaveData,
  type SickLeaveData,
  type SickLeaveEntryRow,
  sickLeaveForCard,
  sickLeaveForCode,
} from '@/features/sick-leave/sick-leave-data';

function row(code: string, title: string, period: string, block = 0): SickLeaveEntryRow {
  return [code, title, block, -1, [['', period, []]], [], ''];
}

const FIXTURE: SickLeaveData = {
  source: { title: 'Письмо', reference: 'Письмо Минздрава и ФСС России', date: '2000-08-21' },
  notes: { advisory: 'Сроки рекомендательные.', deviation: 'Отклонение на 30 %.' },
  footnotes: ['Только при стационарном лечении.'],
  groups: ['Туберкулез легких'],
  blocks: [
    ['A00-A09', 'Кишечные инфекции', []],
    ['F00-F09', 'Психические расстройства', []],
  ],
  entries: [
    row('A00', 'Холера', '9 - 11'),
    row('A01.0', 'Брюшной тиф', '34 - 45'),
    row('A01.1', 'Паратиф А', '30 - 40'),
    row('A03.-', 'Шигеллез', '10 - 20'),
    row('F04-F06', 'Органические расстройства', '14 - 30', 1),
    [
      'S02.0.0',
      'Перелом свода черепа (закрытый)',
      1,
      0,
      [['Со смещением', '150 - 165', [0]]],
      [],
      '',
    ],
    row('S02.0.1', 'Перелом свода черепа (открытый)', '160 - 175', 1),
    row('A18.1', 'Туберкулез уретры', '4 - 6 мес.'),
  ],
};

describe('sickLeaveForCode', () => {
  it('matches a code exactly', () => {
    expect(sickLeaveForCode(FIXTURE, 'A01.0')?.entries.map((entry) => entry.title)).toEqual([
      'Брюшной тиф',
    ]);
  });

  it('does not match a sibling code', () => {
    expect(sickLeaveForCode(FIXTURE, 'A01.2')).toBeNull();
  });

  it('matches any code below a «X.-» row, and the category itself', () => {
    expect(sickLeaveForCode(FIXTURE, 'A03.1')?.entries[0]?.code).toBe('A03.-');
    expect(sickLeaveForCode(FIXTURE, 'A03')?.entries[0]?.code).toBe('A03.-');
  });

  it('matches a code below a three-character row', () => {
    expect(sickLeaveForCode(FIXTURE, 'A00.1')?.entries[0]?.title).toBe('Холера');
  });

  it('shows the rows below a category card', () => {
    expect(sickLeaveForCode(FIXTURE, 'A01')?.entries.map((entry) => entry.code)).toEqual([
      'A01.0',
      'A01.1',
    ]);
  });

  it('matches a code inside a range row, and not one outside it', () => {
    expect(sickLeaveForCode(FIXTURE, 'F05.0')?.entries[0]?.code).toBe('F04-F06');
    expect(sickLeaveForCode(FIXTURE, 'F06')?.entries[0]?.code).toBe('F04-F06');
    expect(sickLeaveForCode(FIXTURE, 'F07.0')).toBeNull();
    expect(sickLeaveForCode(FIXTURE, 'F03')).toBeNull();
  });

  it('maps an injury code to the closed and open rows of the letter', () => {
    expect(sickLeaveForCode(FIXTURE, 'S02.0')?.entries.map((entry) => entry.code)).toEqual([
      'S02.0.0',
      'S02.0.1',
    ]);
    expect(sickLeaveForCode(FIXTURE, 'S02.1')).toBeNull();
  });

  it('resolves groups and footnote texts of an entry', () => {
    const entry = sickLeaveForCode(FIXTURE, 'S02.0')?.entries[0];
    expect(entry?.group).toBe('Туберкулез легких');
    expect(entry?.periods[0]?.footnotes).toEqual(['Только при стационарном лечении.']);
    expect(entry?.blockRange).toBe('F00-F09');
  });

  it('normalizes lookalike and spaced codes and rejects ranges and junk', () => {
    expect(sickLeaveForCode(FIXTURE, ' a01.0 ')?.code).toBe('A01.0');
    expect(sickLeaveForCode(FIXTURE, 'А01.0')?.code).toBe('A01.0');
    expect(sickLeaveForCode(FIXTURE, 'A00-A09')).toBeNull();
    expect(sickLeaveForCode(FIXTURE, 'не код')).toBeNull();
  });
});

describe('parseSickLeaveData', () => {
  it('accepts the fixture and rejects a malformed asset', () => {
    expect(parseSickLeaveData(FIXTURE)).toBe(FIXTURE);
    expect(() => parseSickLeaveData({})).toThrow('unexpected shape');
    expect(() => parseSickLeaveData({ ...FIXTURE, entries: [['A00']] })).toThrow('malformed entry');
  });
});

describe('bundled asset', () => {
  it('has the shape of the letter: 16 tables worth of rows with a source line and the notes', async () => {
    const data = await loadSickLeaveData();
    expect(data.entries.length).toBeGreaterThan(800);
    expect(data.source.reference).toContain('2510/9362-34');
    expect(data.source.reference).toContain('02-08/10-1977П');
    expect(data.source.date).toBe('2000-08-21');
    expect(data.notes.advisory).toContain('рекомендательный характер');
    expect(data.notes.deviation).toContain('30 и более процентов');
    for (const entry of data.entries) {
      expect(entry[0]).toMatch(
        /^[A-Z]\d{2}(?:\.\d){0,2}$|^[A-Z]\d{2}\.-$|^[A-Z]\d{2}-[A-Z]\d{2}$/u,
      );
      expect(entry[4].length).toBeGreaterThan(0);
      expect(data.blocks[entry[2]]).toBeDefined();
      for (const period of entry[4]) {
        expect(period[1]).toMatch(
          /^$|^\d+(?:,\d)?(?: - \d+(?:,\d)?)?(?: мес\.)?(?:,? (?:возможно )?МСЭ)?$/u,
        );
        for (const note of period[2]) expect(data.footnotes[note]).toBeDefined();
      }
    }
  });

  it('finds the letter rows for real ICD-10 cards', async () => {
    const data = await loadSickLeaveData();
    expect(sickLeaveForCode(data, 'A00.1')?.entries[0]?.title).toBe('Холера');
    expect(sickLeaveForCode(data, 'A00.1')?.entries[0]?.periods.map((item) => item.period)).toEqual(
      ['9 - 11', '15 - 20'],
    );
    expect(sickLeaveForCode(data, 'A03.9')?.entries[0]?.code).toBe('A03.-');
    expect(sickLeaveForCode(data, 'F05.0')?.entries[0]?.code).toBe('F04-F06');
    // The letter prints F18.1 for tuberculosis of the genitourinary organs; the asset files it as A18.1.
    expect(
      sickLeaveForCode(data, 'A18.1')?.entries.some((entry) => entry.title.includes('уретры')),
    ).toBe(true);
    expect(sickLeaveForCode(data, 'S72.0')?.entries[0]?.periods[0]?.period).toBe('170 - 190');
  });

  it('pairs features with periods where the letter prints them on different lines', async () => {
    const data = await loadSickLeaveData();
    expect(
      sickLeaveForCode(data, 'K35.0')
        ?.entries.find((entry) => entry.code === 'K35.0')
        ?.periods.map((item) => `${item.features}=${item.period}`),
    ).toEqual(['прободением=26 - 30', 'перитонитом=30 - 40']);
    expect(
      sickLeaveForCode(data, 'T22.3')?.entries[0]?.periods.map(
        (item) => `${item.features}=${item.period}`,
      ),
    ).toEqual(['Без осложнения=40 - 80', 'С осложнением=60 - 100']);
  });

  it('is silent for codes the letter does not cover', async () => {
    const data = await loadSickLeaveData();
    expect(sickLeaveForCode(data, 'Z00.0')).toBeNull();
    expect(await sickLeaveForCard(['Z00.0', 'A00-A09'])).toMatchObject({ results: [] });
    expect(await sickLeaveForCard(['A00-A09'])).toBeNull();
  });
});
