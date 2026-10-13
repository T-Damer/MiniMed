import { describe, expect, it } from 'vitest';

import { parseDoseQuery } from './dose-query';

const YEAR = 365.25;

describe('parseDoseQuery', () => {
  it.each([
    [
      'амоксициллин ребенок 20 кг',
      { name: 'амоксициллин', weightKg: 20, group: 'child', ageDays: null },
    ],
    ['амоксициллин ребёнок 20 кг', { name: 'амоксициллин', weightKg: 20, group: 'child' }],
    [
      'амоксициллин 6 лет 20кг',
      { name: 'амоксициллин', weightKg: 20, ageDays: Math.round(6 * YEAR), group: null },
    ],
    ['парацетамол 15 кг', { name: 'парацетамол', weightKg: 15 }],
    ['ибупрофен 3 года', { name: 'ибупрофен', ageDays: Math.round(3 * YEAR) }],
    ['цефтриаксон 70 кг', { name: 'цефтриаксон', weightKg: 70 }],
    [
      'азитромицин ребенку 5 лет 18 кг 5 дней',
      { name: 'азитромицин', ageDays: Math.round(5 * YEAR), weightKg: 18, days: 5 },
    ],
    ['метформин пожилой', { name: 'метформин', ageDays: Math.round(65 * YEAR) }],
    [
      'амоксициллин 8 мес 9 кг',
      { name: 'амоксициллин', weightKg: 9, ageDays: Math.round((8 * YEAR) / 12) },
    ],
    ['доза ибупрофена ребенку', { name: 'ибупрофена', group: 'child', asksDose: true }],
    [
      'сколько давать нурофен ребенку 4 года',
      { name: 'нурофен', ageDays: Math.round(4 * YEAR), asksDose: true },
    ],
    ['амоксициллин на 7 дней', { name: 'амоксициллин', days: 7 }],
    ['амоксициллин взрослому', { name: 'амоксициллин', group: 'adult' }],
    ['амоксициллин суспензия ребенку 2 года 12 кг', { name: 'амоксициллин', form: 'суспензия' }],
    ['амоксициллин 250 мг ребенок 20 кг', { name: 'амоксициллин', strengthMg: 250, weightKg: 20 }],
  ])('%s', (query, expected) => {
    expect(parseDoseQuery(query)).toMatchObject(expected);
  });

  it('reads the state words', () => {
    expect(parseDoseQuery('амоксициллин беременность')).toMatchObject({
      name: 'амоксициллин',
      pregnant: true,
    });
    expect(parseDoseQuery('амоксициллин ГВ 60 кг')).toMatchObject({
      lactating: true,
      weightKg: 60,
    });
    expect(parseDoseQuery('метформин почечная недостаточность 70 кг')).toMatchObject({
      name: 'метформин',
      renal: true,
      weightKg: 70,
    });
  });

  it('reads a course in weeks only next to a course word', () => {
    expect(parseDoseQuery('амоксициллин на 2 недели')).toMatchObject({ days: 14 });
    expect(parseDoseQuery('амоксициллин ребенок 3 недели 4 кг')).toMatchObject({ weightKg: 4 });
    expect(parseDoseQuery('амоксициллин ребенок 3 недели 4 кг')?.days).toBeNull();
  });

  it('is not a question without patient data, or without a drug name', () => {
    expect(parseDoseQuery('амоксициллин')).toBeNull();
    expect(parseDoseQuery('амоксициллин 500 мг')).toBeNull();
    expect(parseDoseQuery('20 кг')).toBeNull();
    expect(parseDoseQuery('ребенок 20 кг')).toBeNull();
    expect(parseDoseQuery('')).toBeNull();
  });

  it('leaves long free text alone', () => {
    expect(
      parseDoseQuery(
        'как лечить острый бронхит у ребенка 3 лет при температуре и сухом кашле без одышки',
      ),
    ).toBeNull();
  });
});
