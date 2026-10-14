import { describe, expect, it } from 'vitest';

import { refineHighlightRanges } from './search-highlight';

function marked(snippet: string, query: string, ranges: readonly [number, number][]): string[] {
  return refineHighlightRanges(
    snippet,
    ranges.map(([start, end]) => ({ start, end })),
    [query],
  ).map((range) => snippet.slice(range.start, range.end));
}

describe('refineHighlightRanges', () => {
  it('stretches a mark that stops in the middle of a word to the whole word', () => {
    const snippet = 'Ацетилсалициловая кислота 500 мг';
    // The core marked the stem «ацетилсалицилов» of the typed «ацетилсалициловая».
    expect(marked(snippet, 'ацетилсалициловая', [[0, 15]])).toEqual(['Ацетилсалициловая']);
  });

  it('keeps a form of the typed word and drops a word that was only an expansion of it', () => {
    const snippet = 'Острые респираторные инфекции и аспирин';
    const ranges: [number, number][] = [
      [0, 6],
      [7, 20],
      [21, 30],
      [33, 39],
    ];
    expect(marked(snippet, 'аспирина', ranges)).toEqual(['аспирин']);
  });

  it('does not mark words that only look like a typed code (J05)', () => {
    const snippet = '- J00-J06 Острые респираторные инфекции верхних дыхательных путей';
    expect(
      marked(snippet, 'J05', [
        [10, 16],
        [17, 30],
        [31, 40],
      ]),
    ).toEqual([]);
  });

  it('marks exactly the typed characters of a code', () => {
    const snippet = 'Код J05AX13 входит в группу';
    expect(marked(snippet, 'J05', [[4, 7]])).toEqual(['J05']);
    expect(marked(snippet, 'J05AX', [[4, 9]])).toEqual(['J05AX']);
  });

  it('does not mark a short word found inside a longer one', () => {
    const snippet = 'Болиголов пятнистый и боли в спине';
    // «боли» inside «Болиголов» is no form of the typed word.
    expect(
      marked(snippet, 'боли', [
        [0, 4],
        [22, 26],
      ]),
    ).toEqual(['боли']);
  });

  it('reads the query the search was rewritten to', () => {
    const snippet = 'Метформин таблетки';
    expect(
      refineHighlightRanges(snippet, [{ start: 0, end: 9 }], ['ьуеащкьшт', 'метформин']).length,
    ).toBe(1);
  });
});
