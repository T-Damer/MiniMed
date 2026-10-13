import { describe, expect, it } from 'vitest';

import { buildNameVocabulary, correctWord, maxTypoCost, vocabularyHasPrefix } from './word-typo';

const vocabulary = buildNameVocabulary([
  'аменция',
  'деменция',
  'помрачение сознания',
  'сумеречное помрачение сознания',
  'помощь при травме',
  'пиелонефрит',
  'аппендицит',
  'метформин',
  'кардиомиопатия',
  'с кровью',
]);

describe('correctWord', () => {
  it('repairs a neighbouring key in the first letters, to the beginning of the name', () => {
    expect(correctWord('помоач', vocabulary)).toEqual({
      original: 'помоач',
      corrected: 'помрач',
      cost: 0.5,
    });
  });

  it('repairs a sound-alike vowel in the first letter', () => {
    expect(correctWord('оменция', vocabulary)?.corrected).toBe('аменция');
  });

  it('repairs a missing doubled letter, a swap and a missing soft sign cheaply', () => {
    expect(correctWord('апендицит', vocabulary)).toMatchObject({
      corrected: 'аппендицит',
      cost: 0.5,
    });
    expect(correctWord('мтеформин', vocabulary)).toMatchObject({
      corrected: 'метформин',
      cost: 0.6,
    });
    expect(correctWord('кровю', vocabulary)?.corrected).toBe('кровью');
  });

  it('leaves a word that begins a name and a word too far from every name', () => {
    expect(correctWord('помр', vocabulary)).toBeNull();
    expect(correctWord('аменц', vocabulary)).toBeNull();
    expect(correctWord('стол', vocabulary)).toBeNull();
    expect(correctWord('жщзхъ', vocabulary)).toBeNull();
  });

  it('never corrects a word shorter than four letters', () => {
    expect(maxTypoCost(3)).toBe(0);
    expect(correctWord('пом', vocabulary)).toBeNull();
  });

  it('allows one full edit from six letters', () => {
    expect(correctWord('кардеомеопатия', vocabulary)?.corrected).toBe('кардиомиопатия');
    expect(correctWord('пиелонифрет', vocabulary)?.corrected).toBe('пиелонефрит');
  });
});

describe('vocabularyHasPrefix', () => {
  it('finds a word beginning with the prefix', () => {
    expect(vocabularyHasPrefix(vocabulary, 'помр')).toBe(true);
    expect(vocabularyHasPrefix(vocabulary, 'помоа')).toBe(false);
  });
});

describe('word forms', () => {
  it('keeps the typed ending after a corrected stem', () => {
    expect(correctWord('оменции', vocabulary)?.corrected).toBe('аменции');
  });

  it('leaves a word form whose stem begins a name', () => {
    expect(correctWord('аменцией', vocabulary)).toBeNull();
  });

  it('corrects a dropped doubled letter before an ending-like tail («амоксицилин»)', () => {
    const drugs = buildNameVocabulary(['амоксициллин', 'аменция']);
    expect(correctWord('амоксицилин', drugs)?.corrected).toBe('амоксициллин');
    expect(correctWord('аменцией', drugs)).toBeNull();
  });

  it('prefers a whole name to the beginning of another at the same cost', () => {
    const drugs = buildNameVocabulary(['цефтриаксон', 'цефтриаксоновый']);
    expect(correctWord('цефтриаксн', drugs)?.corrected).toBe('цефтриаксон');
  });
});
