import { describe, expect, it } from 'vitest';
import { nameQueryVariants, swapKeyboardLayout, transliterateLatinName } from './name-variants';

const queries = (query: string) => nameQueryVariants(query).map((variant) => variant.query);

describe('swapKeyboardLayout', () => {
  it('reads Russian-layout keys as English and back', () => {
    expect(swapKeyboardLayout('ьуеащкьшт')).toBe('metformin');
    expect(swapKeyboardLayout('vtnajhvby')).toBe('метформин');
  });

  it('maps punctuation keys that are letters on the other layout', () => {
    expect(swapKeyboardLayout('[kjhfvatybrjk')).toBe('хлорамфеникол');
    expect(swapKeyboardLayout('f,frfdbh')).toBe('абакавир');
  });

  it('leaves punctuation and digits alone in a word that has digits', () => {
    expect(swapKeyboardLayout('ibuprofen 400.5')).toBe('шигзкщаут 400.5');
  });

  it('declines anything that is not a short single-script name', () => {
    expect(swapKeyboardLayout('J18.9')).toBeNull();
    expect(swapKeyboardLayout('метformin')).toBeNull();
    expect(swapKeyboardLayout('боль в животе у ребенка после еды')).toBeNull();
    expect(swapKeyboardLayout('')).toBeNull();
  });
});

describe('transliterateLatinName', () => {
  it('reads Latin spellings of drug names as Russian names first', () => {
    expect(transliterateLatinName('nurofen')[0]).toBe('нурофен');
    expect(transliterateLatinName('paracetamol')[0]).toBe('парацетамол');
    expect(transliterateLatinName('metformin')[0]).toBe('метформин');
    expect(transliterateLatinName('amoxicillin')[0]).toBe('амоксициллин');
    expect(transliterateLatinName('omeprazole')[0]).toBe('омепразол');
    expect(transliterateLatinName('hydrocortisone')[0]).toBe('гидрокортисон');
    expect(transliterateLatinName('erythromycin')[0]).toBe('эритромицин');
  });

  it('offers the common alternative readings', () => {
    expect(transliterateLatinName('amoxicillin')).toContain('амоксицилин');
    expect(transliterateLatinName('hydrocortisone')).toContain('хидрокортисон');
    expect(transliterateLatinName('chlorhexidine')[0]).toBe('хлоргексидин');
  });

  it('keeps numbers and transliterates a dose unit', () => {
    expect(transliterateLatinName('ibuprofen 400mg')[0]).toBe('ибупрофен 400мг');
  });

  it('is empty for Cyrillic, codes and long phrases', () => {
    expect(transliterateLatinName('метформин')).toEqual([]);
    expect(transliterateLatinName('J18.9')).toEqual([]);
    expect(transliterateLatinName('acute otitis media in children')).toEqual([]);
  });
});

describe('nameQueryVariants', () => {
  it('recovers a Latin name typed on the Russian layout through both steps', () => {
    expect(queries('ьуеащкьшт')).toEqual(['metformin', 'метформин', 'мэтформин']);
  });

  it('lists the other layout first, then Russian readings of a Latin spelling', () => {
    const variants = queries('nurofen');
    expect(variants).toContain('нурофен');
    expect(variants[0]).toBe('тгкщаут');
  });

  it('never proposes the typed query itself', () => {
    expect(queries('метформин')).not.toContain('метформин');
  });

  it('gives nothing for codes, short abbreviations and long phrases', () => {
    expect(queries('J18.9')).toEqual([]);
    expect(queries('ЭКГ')).toEqual([]);
    expect(queries('HbA1c')).toEqual(['риф1с']);
    expect(queries('острый бронхит у детей раннего возраста')).toEqual([]);
  });

  it('is deterministic and bounded', () => {
    expect(nameQueryVariants('hydrocortisone')).toEqual(nameQueryVariants('hydrocortisone'));
    expect(nameQueryVariants('hydrocortisone acetate', 4).length).toBeLessThanOrEqual(4);
  });
});
