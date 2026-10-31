import { describe, expect, it } from 'vitest';

import {
  buildNameVocabulary,
  CONFIDENT_TYPO_COST,
  correctWord,
  maxTypoCost,
  vocabularyHasPrefix,
} from './word-typo';

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

  it('repairs a dropped vowel to the whole name, not a neighbouring-key prefix («ибупрофн»)', () => {
    const drugs = buildNameVocabulary(['ибупрофен', 'ибупрофена']);
    expect(correctWord('ибупрофн', drugs)?.corrected).toBe('ибупрофен');
  });

  it('prefers a whole name to the beginning of another at the same cost', () => {
    const drugs = buildNameVocabulary(['цефтриаксон', 'цефтриаксоновый']);
    expect(correctWord('цефтриаксн', drugs)?.corrected).toBe('цефтриаксон');
  });
});

describe('real misspellings (roadmap item 24)', () => {
  const names = buildNameVocabulary([
    'депрессия',
    'гемолитическая желтуха',
    'складчатый язык',
    'валацикловир',
    'клещевина',
    'дебильность',
    'отравление мышьяком',
    'гипофизит',
  ]);

  it('allows two full edits from eight letters, one and a half at seven, one at six', () => {
    expect(maxTypoCost(4)).toBe(0.5);
    expect(maxTypoCost(5)).toBe(0.5);
    expect(maxTypoCost(6)).toBe(1);
    expect(maxTypoCost(7)).toBe(1.5);
    expect(maxTypoCost(8)).toBe(2);
    expect(maxTypoCost(14)).toBe(2);
    expect(CONFIDENT_TYPO_COST).toBe(1);
  });

  it('repairs two unrelated letters in a long word', () => {
    expect(correctWord('дшпресшия', names)).toMatchObject({ corrected: 'депрессия', cost: 2 });
  });

  it('repairs a dropped consonant and a doubled letter anywhere in the word', () => {
    expect(correctWord('дебильнсть', names)?.corrected).toBe('дебильность');
    expect(correctWord('дебильноссть', names)?.corrected).toBe('дебильность');
    expect(correctWord('гипофиит', names)?.corrected).toBe('гипофизит');
  });

  it('reads «ц» for «тс» and «щ» for «сч» as half an edit', () => {
    expect(correctWord('валатсикловир', names)).toMatchObject({
      corrected: 'валацикловир',
      cost: 0.5,
    });
    expect(correctWord('клесчевина', names)).toMatchObject({ corrected: 'клещевина', cost: 0.5 });
    expect(correctWord('валацикловир', names)).toBeNull();
  });

  it('repairs a left-out letter at the end of a word that looks like a word form', () => {
    // «складчатй» = the stem «складчат» + a tail an ending could be, yet no word of the corpus.
    expect(correctWord('складчатй', names)).toMatchObject({
      corrected: 'складчатый',
      cost: 0.5,
    });
  });

  it('corrects a word form only by one cheap edit to a whole word', () => {
    const forms = buildNameVocabulary(['дуоденальный', 'аменция']);
    // a legitimate form is not rewritten into the base name, an ending is not cut
    expect(correctWord('дуоденальной', forms)).toBeNull();
    expect(correctWord('аменцией', forms)).toBeNull();
  });

  it('prefers a whole name word to a name beginning with the typed ending on it', () => {
    expect(correctWord('гемолитичесая', names)?.corrected).toBe('гемолитическая');
  });

  it('reads sound-alike vowels in the middle of a name at half an edit each', () => {
    expect(correctWord('гемолитическоя', names)).toMatchObject({
      corrected: 'гемолитическая',
      cost: 0.5,
    });
  });
});
