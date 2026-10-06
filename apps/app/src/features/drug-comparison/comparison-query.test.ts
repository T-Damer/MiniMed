import { describe, expect, it } from 'vitest';

import { parseComparisonQuery } from './comparison-query';

const names = (query: string): readonly string[] | null =>
  parseComparisonQuery(query)?.names ?? null;

describe('parseComparisonQuery', () => {
  it('reads «X или Y» and «X vs Y» as a bare comparison', () => {
    expect(parseComparisonQuery('ибупрофен или парацетамол')).toEqual({
      names: ['ибупрофен', 'парацетамол'],
      cue: 'bare',
    });
    expect(names('нурофен vs пенталгин')).toEqual(['нурофен', 'пенталгин']);
    expect(names('Нурофен VS. Пенталгин')).toEqual(['Нурофен', 'Пенталгин']);
    expect(names('ibuprofen versus paracetamol')).toEqual(['ibuprofen', 'paracetamol']);
    expect(names('амоксиклав или аугментин или флемоксин')).toEqual([
      'амоксиклав',
      'аугментин',
      'флемоксин',
    ]);
  });

  it('reads cue phrases and drops the words that frame the question', () => {
    expect(parseComparisonQuery('сравнить ибупрофен и парацетамол')).toEqual({
      names: ['ибупрофен', 'парацетамол'],
      cue: 'explicit',
    });
    expect(names('сравнение нурофена и пенталгина')).toEqual(['нурофена', 'пенталгина']);
    expect(names('чем отличается нурофен от ибупрофена')).toEqual(['нурофен', 'ибупрофена']);
    expect(names('чем отличаются эналаприл и лизиноприл?')).toEqual(['эналаприл', 'лизиноприл']);
    expect(names('разница между омепразолом и эзомепразолом')).toEqual([
      'омепразолом',
      'эзомепразолом',
    ]);
    expect(names('в чем разница между кетонал и кеторол')).toEqual(['кетонал', 'кеторол']);
    expect(names('что лучше нурофен или пенталгин')).toEqual(['нурофен', 'пенталгин']);
    expect(names('сравнить ибупрофен, парацетамол, аспирин')).toEqual([
      'ибупрофен',
      'парацетамол',
      'аспирин',
    ]);
  });

  it('keeps two-word names and Latin names', () => {
    expect(names('нурофен экспресс или ибупрофен')).toEqual(['нурофен экспресс', 'ибупрофен']);
    expect(names('сравнить Nurofen и Panadol')).toEqual(['Nurofen', 'Panadol']);
  });

  it('gives at most four names, one each', () => {
    expect(names('a1 или b1 или c1 или d1 или e1')).toBeNull();
    expect(names('ибупрофен или Ибупрофен')).toBeNull();
    expect(names('ибупрофен или ибупрофен или парацетамол')).toEqual(['ибупрофен', 'парацетамол']);
  });

  it('does not read queries that are not a comparison', () => {
    expect(parseComparisonQuery('ибупрофен')).toBeNull();
    expect(parseComparisonQuery('ибупрофен и парацетамол')).toBeNull();
    expect(parseComparisonQuery('ибупрофен взаимодействие с парацетамолом')).toBeNull();
    expect(parseComparisonQuery('')).toBeNull();
    expect(parseComparisonQuery('или')).toBeNull();
    expect(parseComparisonQuery('сравнить')).toBeNull();
    expect(parseComparisonQuery('ибупрофен или')).toBeNull();
    expect(parseComparisonQuery('x'.repeat(300))).toBeNull();
  });

  it('leaves a long clinical phrase with «или» to the name lookup, which finds no drug in it', () => {
    // Parsed (it is syntactically «X или Y»); the card appears only if both parts name a drug.
    expect(names('менингит или энцефалит')).toEqual(['менингит', 'энцефалит']);
    expect(
      parseComparisonQuery(
        'боль в животе у ребёнка с лихорадкой или без лихорадки неясной этиологии',
      ),
    ).toBeNull();
  });
});
