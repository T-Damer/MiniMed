import { describe, expect, it } from 'vitest';

import { correctedText, correctionPieces, letterPieces } from './search-correction';

describe('letterPieces', () => {
  it('shows a wrong letter struck out and the right one added, keeping the typed case', () => {
    expect(letterPieces('Помоач', 'помрач')).toEqual([
      { text: 'Пом', kind: 'same' },
      { text: 'о', kind: 'removed' },
      { text: 'р', kind: 'added' },
      { text: 'ач', kind: 'same' },
    ]);
  });

  it('gives an added first letter the case of the letter it replaces', () => {
    expect(letterPieces('Оменция', 'аменция')).toEqual([
      { text: 'О', kind: 'removed' },
      { text: 'А', kind: 'added' },
      { text: 'менция', kind: 'same' },
    ]);
  });

  it('shows a missing letter as added only, upper case in an all-capital word', () => {
    expect(letterPieces('ЦЕФТРИАКСН', 'цефтриаксон')).toEqual([
      { text: 'ЦЕФТРИАКС', kind: 'same' },
      { text: 'О', kind: 'added' },
      { text: 'Н', kind: 'same' },
    ]);
  });

  it('keeps a typed «ё» the core reads as «е»', () => {
    expect(letterPieces('ёлка', 'елка')).toEqual([{ text: 'ёлка', kind: 'same' }]);
  });
});

describe('correctionPieces', () => {
  const corrections = [{ original: 'оменции', corrected: 'аменции', score: 0.9 }];

  it('marks only the corrected word inside the typed text', () => {
    const pieces = correctionPieces('лечение  Оменции?', corrections);
    expect(pieces).toEqual([
      { text: 'лечение  ', kind: 'same' },
      { text: 'О', kind: 'removed' },
      { text: 'А', kind: 'added' },
      { text: 'менции?', kind: 'same' },
    ]);
    expect(correctedText(pieces ?? [])).toBe('лечение  Аменции?');
  });

  it('is null once the corrected word is no longer in the box', () => {
    expect(correctionPieces('лечение', corrections)).toBeNull();
  });
});
