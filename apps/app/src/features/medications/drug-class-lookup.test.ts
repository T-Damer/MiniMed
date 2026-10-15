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
    for (const query of ['пневмония', 'азитромицин', 'J01FA', 'группа', 'препараты', '']) {
      expect(classOfQuery(vocabulary, query), query).toBeNull();
    }
  });

  it('reads a class word inside a longer query and returns the other words (SRCH2)', () => {
    const inside = (query: string) => classOfQuery(vocabulary, query);
    expect(inside('макролиды детям')?.groups.map((group) => group.code)).toEqual(['J01FA']);
    expect(inside('макролиды детям')?.rest).toEqual(['детям']);
    expect(inside('статины при беременности')?.groups.map((group) => group.code)).toEqual([
      'C10AA',
    ]);
    expect(inside('статины при беременности')?.rest).toEqual(['при', 'беременности']);
    expect(inside('ингибиторы АПФ кашель')?.rest).toEqual(['кашель']);
    expect(inside('ингибитор АПФ кашель')?.groups.map((group) => group.code)).toContain('C09AA');
    expect(inside('аллергия на макролиды')?.rest).toEqual(['аллергия', 'на']);
    expect(inside('макролиды при пневмонии')?.label).toBe('Макролиды');
    // The longest run wins: «ингибиторы протонной помпы» is not the shorter «ингибиторы …».
    expect(
      inside('ингибиторы протонной помпы при гастрите')?.groups.map((group) => group.code),
    ).toEqual(['A02BC']);
    expect(inside('НПВС и желудок')?.groups.map((group) => group.code)).toEqual(['M01A']);
    expect(inside('препараты группы статинов при подагре')?.groups[0]?.code).toBe('C10AA');
    // A whole-query match has no rest.
    expect(classOfQuery(vocabulary, 'макролиды')).not.toHaveProperty('rest');
  });

  it('does not read a drug, a singular word or an ordinary phrase as the class of a longer query', () => {
    for (const query of [
      'инсулин при беременности',
      'витамин D дефицит',
      'антибиотик ребенку',
      'статин-индуцированная миопатия',
      'аспирин при головной боли',
      'боль в животе у ребенка',
      'сахарный диабет 2 типа',
      'лекарства от кашля',
      // A sentence, not a class with a qualifier.
      'нужны ли антибактериальные препараты при ротавирусном гастроэнтерите',
    ]) {
      expect(classOfQuery(vocabulary, query), query).toBeNull();
    }
  });

  it('does not even load the dictionary for a query with a digit or too many words', async () => {
    expect(await classOfSearchQuery('статины 20 мг')).toBeNull();
    expect(await classOfSearchQuery('а б в г д е ж')).toBeNull();
  });
});
