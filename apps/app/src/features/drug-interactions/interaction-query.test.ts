import { describe, expect, it } from 'vitest';

import { parseInteractionQuery } from './interaction-query';

describe('parseInteractionQuery', () => {
  it('reads «X взаимодействие с Y, Z»', () => {
    expect(parseInteractionQuery('варфарин взаимодействие с ибупрофеном, аспирином')).toEqual({
      names: ['варфарин', 'ибупрофеном', 'аспирином'],
    });
  });

  it('reads «совместимость X и Y»', () => {
    expect(parseInteractionQuery('совместимость Нурофен и Парацетамол')).toEqual({
      names: ['Нурофен', 'Парацетамол'],
    });
  });

  it('reads «взаимодействие между X и Y» and a «+» separator', () => {
    expect(parseInteractionQuery('взаимодействие между метформином и амлодипином')).toEqual({
      names: ['метформином', 'амлодипином'],
    });
    expect(parseInteractionQuery('Эналаприл + Лозартан совместимость')).toEqual({
      names: ['Эналаприл', 'Лозартан'],
    });
  });

  it('keeps a multi-word name in one piece', () => {
    expect(parseInteractionQuery('ацетилсалициловая кислота взаимодействие с варфарином')).toEqual({
      names: ['ацетилсалициловая кислота', 'варфарином'],
    });
  });

  it('treats alcohol as a named substance without a cue word', () => {
    expect(parseInteractionQuery('нурофен и алкоголь')).toEqual({
      names: ['нурофен', 'алкоголь'],
    });
    expect(parseInteractionQuery('метронидазол с алкоголем')).toEqual({
      names: ['метронидазол', 'алкоголь'],
    });
  });

  it('leaves ordinary and name queries alone', () => {
    expect(parseInteractionQuery('нурофен')).toBeNull();
    expect(parseInteractionQuery('пневмония и бронхит')).toBeNull();
    expect(parseInteractionQuery('взаимодействие')).toBeNull();
    expect(parseInteractionQuery('совместимость')).toBeNull();
    expect(parseInteractionQuery('')).toBeNull();
    expect(parseInteractionQuery('x'.repeat(300))).toBeNull();
  });

  it('drops duplicates and caps the list', () => {
    expect(parseInteractionQuery('варфарин взаимодействие с Варфарин, аспирин')).toEqual({
      names: ['варфарин', 'аспирин'],
    });
    const many = Array.from(
      { length: 14 },
      (_, index) => `препаратх${'абвгдежзик'[index % 10]}${index}`,
    );
    const parsed = parseInteractionQuery(`взаимодействие ${many.join(', ')}`);
    expect(parsed?.names).toHaveLength(10);
  });
});
