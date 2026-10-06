import { describe, expect, it } from 'vitest';

import { parseSafetyQuery } from './safety-query';

const YEAR = 365.25;

describe('parseSafetyQuery: lactation', () => {
  it.each([
    ['ибупрофен разрешён ли во время ГВ', 'ибупрофен'],
    ['Амоксициллин разрешен ли во время ГВ (грудного вскармливания)', 'Амоксициллин'],
    ['парацетамол при грудном вскармливании', 'парацетамол'],
    ['нурофен можно кормящей', 'нурофен'],
    ['кормящей маме можно омепразол', 'омепразол'],
    ['лактация и метформин', 'метформин'],
    ['цетрин при лактации', 'цетрин'],
  ])('%s', (query, name) => {
    expect(parseSafetyQuery(query)).toMatchObject({ name, intents: ['lactation'], age: null });
  });
});

describe('parseSafetyQuery: pregnancy', () => {
  it('reads «X при беременности»', () => {
    expect(parseSafetyQuery('ибупрофен при беременности')).toEqual({
      name: 'ибупрофен',
      intents: ['pregnancy'],
      age: null,
      trimester: null,
    });
  });

  it('reads a trimester', () => {
    expect(parseSafetyQuery('нимесулид 2 триместр беременности')).toMatchObject({
      name: 'нимесулид',
      intents: ['pregnancy'],
      trimester: 2,
    });
    expect(parseSafetyQuery('ципрофлоксацин в III триместре')).toMatchObject({
      name: 'ципрофлоксацин',
      trimester: 3,
    });
  });

  it('reads «беременным можно X»', () => {
    expect(parseSafetyQuery('беременным можно но-шпа')).toMatchObject({
      name: 'но-шпа',
      intents: ['pregnancy'],
    });
  });

  it('reads both questions', () => {
    expect(parseSafetyQuery('лоратадин при беременности и лактации')).toMatchObject({
      name: 'лоратадин',
      intents: ['pregnancy', 'lactation'],
    });
  });
});

describe('parseSafetyQuery: age', () => {
  it('reads «X ребёнку 3 лет»', () => {
    const query = parseSafetyQuery('ибупрофен ребёнку 3 лет');
    expect(query).toMatchObject({ name: 'ибупрофен', intents: ['age'] });
    expect(query?.age).toEqual({ days: Math.round(3 * YEAR), kind: 'exact', text: '3 года' });
  });

  it('reads months and written numbers', () => {
    expect(parseSafetyQuery('нурофен ребенку 6 месяцев')?.age?.text).toBe('6 месяцев');
    expect(parseSafetyQuery('нурофен ребенку трех лет')?.age?.text).toBe('3 года');
  });

  it('reads an upper bound «до 5 лет»', () => {
    const query = parseSafetyQuery('амбробене ребёнку до 5 лет');
    expect(query).toMatchObject({ name: 'амбробене', intents: ['age'] });
    expect(query?.age).toMatchObject({ kind: 'upTo', text: '5 лет' });
  });

  it('reads «с какого возраста X»', () => {
    expect(parseSafetyQuery('с какого возраста нимесулид')).toEqual({
      name: 'нимесулид',
      intents: ['age'],
      age: null,
      trimester: null,
    });
    expect(parseSafetyQuery('пенталгин с какого возраста можно')?.name).toBe('пенталгин');
  });

  it('reads «X детям»', () => {
    expect(parseSafetyQuery('аугментин детям')).toMatchObject({
      name: 'аугментин',
      intents: ['age'],
    });
  });

  it('keeps a typed age out of the name, not out of the question', () => {
    expect(parseSafetyQuery('ибупрофен ребёнку 3 года')?.name).toBe('ибупрофен');
  });
});

describe('parseSafetyQuery: what it leaves alone', () => {
  it.each([
    'ибупрофен',
    'диабет 2 года',
    'нурофен детский',
    'беременность',
    'ребенку',
    'при беременности',
    'как лечить кашель у ребенка и взрослого в домашних условиях быстро',
    'ГВ',
  ])('%s', (query) => {
    expect(parseSafetyQuery(query)).toBeNull();
  });

  it('is deterministic and never reads a name from digits only', () => {
    expect(parseSafetyQuery('3 года ребенку')).toBeNull();
  });
});
