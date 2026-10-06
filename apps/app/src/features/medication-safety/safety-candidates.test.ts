import { describe, expect, it } from 'vitest';

import { namesCoverTypedWords } from './safety-candidates';

describe('namesCoverTypedWords', () => {
  it('accepts a typed name that begins a word of the names', () => {
    expect(namesCoverTypedWords(['ИБУПРОФЕН: описание', 'Нурофен'], ['ибупроф'])).toBe(true);
    expect(
      namesCoverTypedWords(
        ['Амоксициллин + клавулановая кислота'],
        ['амоксициллин', 'клавулановая'],
      ),
    ).toBe(true);
  });

  it('accepts a typed name with an inflection ending', () => {
    expect(namesCoverTypedWords(['Ибупрофен'], ['ибупрофена'])).toBe(true);
    expect(namesCoverTypedWords(['Ибупрофен'], ['ибупрофеновая'])).toBe(false);
  });

  it('refuses a name the group does not carry', () => {
    expect(namesCoverTypedWords(['Гипертоническая болезнь'], ['давление'])).toBe(false);
    expect(namesCoverTypedWords(['Ибупрофен'], ['ибупрофен', 'давление'])).toBe(false);
  });

  it('refuses an empty question', () => {
    expect(namesCoverTypedWords(['Ибупрофен'], [])).toBe(false);
  });

  it('does not read a short group name inside a longer typed word', () => {
    expect(namesCoverTypedWords(['Боли'], ['болиголов'])).toBe(false);
  });
});
