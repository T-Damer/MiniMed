import { describe, expect, it } from 'vitest';

import { LEGACY_SEMANTIC_FUSION, queryClauses, semanticStrengths } from '../src';

describe('query clauses', () => {
  it('splits a complaint into its statements in the original wording', () => {
    expect(
      queryClauses('Боли в эпигастрии до приёма пищи, чувство тяжести после еды. Боли в горле.'),
    ).toEqual(['Боли в эпигастрии до приёма пищи', 'чувство тяжести после еды', 'Боли в горле']);
  });

  it('keeps single statements, short leftovers and duplicates out', () => {
    expect(queryClauses('острый бронхит')).toEqual([]);
    expect(queryClauses('кашель, т.')).toEqual([]);
    expect(queryClauses('кашель ночью, кашель ночью')).toEqual([]);
  });

  it('embeds at most four clauses', () => {
    expect(queryClauses('a b, c d, e f, g h, i j, k l')).toHaveLength(4);
  });
});

describe('semantic strengths', () => {
  const fusion = { ...LEGACY_SEMANTIC_FUSION, band: 0.1, clauseCoverageWeight: 0.5 };
  const hit = (chunkId: string, documentId: string, score: number) => ({
    chunkId,
    documentId,
    score,
  });

  it('maps cosines into the band below each list’s best hit', () => {
    const strengths = semanticStrengths([[hit('a', 'A', 0.9), hit('b', 'B', 0.85)]], fusion);
    expect(strengths.get('a')).toBeCloseTo(1);
    expect(strengths.get('b')).toBeCloseTo(0.5);
  });

  it('raises a document that answers every clause above one matching only the whole query', () => {
    const whole = [hit('a', 'A', 0.9), hit('b', 'B', 0.9)];
    const fever = [hit('b1', 'B', 0.88), hit('a1', 'A', 0.8)];
    const cough = [hit('b2', 'B', 0.87), hit('x', 'X', 0.86)];
    const strengths = semanticStrengths([whole, fever, cough], fusion);
    expect(strengths.get('b') ?? 0).toBeGreaterThan(strengths.get('a') ?? 0);
  });

  it('ignores coverage with fewer than two clauses or no weight', () => {
    const whole = [hit('a', 'A', 0.9)];
    expect(semanticStrengths([whole, [hit('a', 'A', 0.8)]], fusion).get('a')).toBeCloseTo(1);
    expect(
      semanticStrengths([whole, whole, whole], { ...fusion, clauseCoverageWeight: 0 }).get('a'),
    ).toBeCloseTo(1);
  });
});
