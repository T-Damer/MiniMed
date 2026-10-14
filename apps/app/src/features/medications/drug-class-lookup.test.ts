import { describe, expect, it } from 'vitest';
import atcNames from './atc-names.json';
import { classOfQuery, classOfSearchQuery, createClassVocabulary } from './drug-class-lookup';

// SRCH1 (owner decision 2026-10-14): the class words of the main search are the app's one class
// vocabulary; every code of the search-only aliases is a group of the shipped НСИ dictionary.
const vocabulary = createClassVocabulary(atcNames.names);
const codes = (query: string): string[] | undefined =>
  classOfQuery(vocabulary, query)?.groups.map((group) => group.code);

describe('the class a query names', () => {
  it('reads inflected forms and the abbreviations of the shared vocabulary', () => {
    for (const query of ['макролиды', 'макролидов', 'Макролидами', 'группа макролидов']) {
      expect(codes(query), query).toEqual(['J01FA']);
    }
    for (const query of ['статины', 'статинов', 'статинами']) {
      expect(codes(query), query).toEqual(['C10AA']);
    }
    expect(codes('НПВС')).toEqual(['M01A']);
    expect(codes('цитостатики')).toContain('L01XX');
    expect(codes('снотворные')).toContain('N05CD');
    expect(codes('ингибиторы АПФ')).toEqual(expect.arrayContaining(['C09AA', 'C09B']));
  });

  it('reads the names a doctor types for a class', () => {
    expect(codes('бета-блокаторы')).toEqual(['C07', 'S01ED']);
    expect(codes('β-блокаторы')).toEqual(['C07', 'S01ED']);
    expect(codes('мочегонные')).toEqual(['C03']);
    expect(codes('сартаны')).toEqual(['C09C', 'C09D']);
    expect(codes('ИПП')).toEqual(['A02BC']);
    expect(codes('ингибиторы протонной помпы')).toEqual(['A02BC']);
    expect(codes('цефалоспорины')).toContain('J01DD');
    expect(codes('цефалоспорины')).not.toContain('J01DH');
  });

  it('labels the class and names its groups from the dictionary', () => {
    expect(classOfQuery(vocabulary, 'макролидов')).toEqual({
      label: 'Макролиды',
      groups: [{ code: 'J01FA', name: 'Макролиды' }],
    });
    expect(classOfQuery(vocabulary, 'НПВП')?.label).toBe('НПВП');
  });

  it('names no class for a disease, a drug, a code or a long phrase', () => {
    for (const query of [
      'пневмония',
      'азитромицин',
      'J01FA',
      'макролиды при пневмонии',
      'группа',
      'препараты',
      '',
    ]) {
      expect(classOfQuery(vocabulary, query), query).toBeNull();
    }
  });

  it('does not even load the dictionary for a query with a digit or too many words', async () => {
    expect(await classOfSearchQuery('статины 20 мг')).toBeNull();
    expect(await classOfSearchQuery('а б в г д е ж')).toBeNull();
  });
});
