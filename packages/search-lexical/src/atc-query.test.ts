import { describe, expect, it } from 'vitest';
import {
  type AtcDirectoryEntry,
  atcCodeMatches,
  findAtcEntries,
  matchAtcEntry,
  parseAtcQueries,
  parseAtcQuery,
} from './atc-query';

describe('parseAtcQuery', () => {
  it.each([
    ['J05', 'J05', 2],
    ['J05A', 'J05A', 3],
    ['J05AX', 'J05AX', 4],
    ['J05AX1', 'J05AX1', 5],
    ['J05AX13', 'J05AX13', 5],
    ['N06BX03', 'N06BX03', 5],
  ] as const)('reads %s as a code of level %#', (typed, code, level) => {
    expect(parseAtcQuery(typed)).toEqual({ code, level, reading: 'plain' });
  });

  it('ignores case and spaces', () => {
    expect(parseAtcQuery('j05ax13')?.code).toBe('J05AX13');
    expect(parseAtcQuery(' J05 AX 13 ')?.code).toBe('J05AX13');
    expect(parseAtcQuery('j 05 a')?.code).toBe('J05A');
    expect(parseAtcQuery('J05 AX')?.code).toBe('J05AX');
  });

  it('reads Cyrillic look-alike letters as Latin ones', () => {
    expect(parseAtcQuery('С01ВА')).toEqual({ code: 'C01BA', level: 4, reading: 'lookalike' });
    expect(parseAtcQuery('А10ВА02')?.code).toBe('A10BA02');
    expect(parseAtcQuery('м01ае')?.code).toBe('M01AE');
    expect(parseAtcQuery('Н02ВЕ01')?.code).toBe('H02BE01');
    expect(parseAtcQuery('N02BE01')?.reading).toBe('plain');
  });

  it('reads Russian-layout keys by their position', () => {
    // J is the key of «о», A the key of «ф», X the key of «ч».
    expect(parseAtcQuery('о05')).toEqual({ code: 'J05', level: 2, reading: 'layout' });
    expect(parseAtcQuery('О05')?.code).toBe('J05');
    expect(parseAtcQuery('о05фч13')?.code).toBe('J05AX13');
    expect(parseAtcQuery('д02')?.code).toBe('L02');
    expect(parseAtcQuery('ь01')?.code).toBe('M01');
    expect(parseAtcQuery('я01')).toBeNull();
  });

  it('reads a mix of look-alikes and layout keys character by character', () => {
    expect(parseAtcQuery('о05АХ13')).toEqual({ code: 'J05AX13', level: 5, reading: 'layout' });
    expect(parseAtcQuery('о05ах13')?.code).toBe('J05AX13');
    // Whole-text key reading first; the mixed reading is the last one the caller tries.
    expect(parseAtcQueries('Д02ВА01').map((query) => query.code)).toEqual(['L02DF01', 'L02BA01']);
  });

  it('reads a code typed wholly on the Russian layout, also where a letter looks like another', () => {
    // «а» is the look of A and the key of F: the whole text decides.
    expect(parseAtcQuery('п01фа20')?.code).toBe('G01AF20');
    expect(parseAtcQueries('в07сс01').map((query) => query.code)).toEqual(['B07CC01', 'D07CC01']);
    expect(parseAtcQuery('и03фу10')?.code).toBe('B03AE10');
  });

  it('gives every reading of a text that has two, the look first', () => {
    // «м01ае01»: M01AE01 by look, V01FT01 by key.
    expect(parseAtcQueries('м01ае01').map((query) => [query.code, query.reading])).toEqual([
      ['M01AE01', 'lookalike'],
      ['V01FT01', 'layout'],
    ]);
    expect(parseAtcQueries('J05AX13').map((query) => query.code)).toEqual(['J05AX13']);
    expect(parseAtcQueries('ВИЧ')).toEqual([]);
  });

  it.each([
    '',
    'J',
    'С',
    'J0',
    'С3',
    'B1',
    'ВИЧ',
    'ВИЧ-инфекция',
    'ибупрофен',
    'парацетамол 500',
    'J05AX13 ацикловир',
    'J05AX133',
    'J05AX131x',
    'JJ05',
    '05J',
    '123',
    'O05',
    'Z05',
    'J05.AX',
    'J05-AX',
    'абв',
    'x'.repeat(40),
  ])('does not read %j as a code', (typed) => {
    expect(parseAtcQuery(typed)).toBeNull();
  });

  it('reads the vitamin «В12» as a code shape; only the lookup keeps it out of the results', () => {
    expect(parseAtcQuery('В12')?.code).toBe('B12');
  });
});

describe('matching a code', () => {
  const entries: AtcDirectoryEntry[] = [
    { id: 'a', name: 'Валганцикловир', codes: ['J05AB14'] },
    { id: 'b', name: 'Ацикловир', codes: ['J05AB01', 'D06BB03'] },
    {
      id: 'c',
      name: 'Умифеновир',
      codes: ['J05AX13', 'L03AX'],
      agreed: [{ code: 'J05AX13', registry: 'L03AX' }],
    },
    { id: 'd', name: 'Стаб', codes: ['J05AX'] },
    { id: 'e', name: 'Ибупрофен', codes: ['M01AE01'] },
  ];
  const entry = (id: string): AtcDirectoryEntry => {
    const found = entries.find((item) => item.id === id);
    if (!found) throw new Error(id);
    return found;
  };

  it('matches a prefix of every level', () => {
    expect(atcCodeMatches({ code: 'J05' }, 'J05AX13')).toBe(true);
    expect(atcCodeMatches({ code: 'J05A' }, 'J05AX13')).toBe(true);
    expect(atcCodeMatches({ code: 'J05AX1' }, 'J05AX13')).toBe(true);
    expect(atcCodeMatches({ code: 'J05AX13' }, 'J05AX')).toBe(false);
    expect(atcCodeMatches({ code: 'J06' }, 'J05AX13')).toBe(false);
  });

  it('finds the drugs of a group, the exact level first, then by name', () => {
    const found = findAtcEntries({ code: 'J05AX' }, entries);
    expect(found.map((match) => match.entry.id)).toEqual(['d', 'c']);
    expect(found[0]?.exact).toBe(true);
    const group = findAtcEntries({ code: 'J05' }, entries);
    expect(group.map((match) => match.entry.name)).toEqual([
      'Ацикловир',
      'Валганцикловир',
      'Стаб',
      'Умифеновир',
    ]);
    expect(group.every((match) => !match.exact)).toBe(true);
  });

  it('shows the matched code of a drug', () => {
    const found = findAtcEntries({ code: 'J05AB01' }, entries);
    expect(found.map((match) => [match.entry.id, match.code, match.exact])).toEqual([
      ['b', 'J05AB01', true],
    ]);
  });

  it('shows the agreed code beside the registry code, whichever of the two was typed', () => {
    expect(matchAtcEntry({ code: 'J05AX13' }, entry('c'))).toMatchObject({
      code: 'J05AX13',
      registryCode: 'L03AX',
      exact: true,
    });
    expect(matchAtcEntry({ code: 'L03' }, entry('c'))).toMatchObject({
      code: 'J05AX13',
      registryCode: 'L03AX',
      exact: false,
    });
    expect(matchAtcEntry({ code: 'D06' }, entry('b'))).toMatchObject({
      code: 'D06BB03',
      registryCode: null,
    });
  });

  it('limits the result and finds nothing for a code no drug carries', () => {
    expect(findAtcEntries({ code: 'J05' }, entries, 2)).toHaveLength(2);
    expect(findAtcEntries({ code: 'B12' }, entries)).toEqual([]);
  });
});
