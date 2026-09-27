import { describe, expect, it } from 'vitest';
import { extract, extractTop, internal, Levenshtein, OSA } from './rapidfuzz';

describe('OSA/Levenshtein basics', () => {
  it('is zero for identical strings, including empty', () => {
    expect(OSA.distance('', '')).toBe(0);
    expect(Levenshtein.distance('', '')).toBe(0);
    expect(OSA.distance('парацетамол', 'парацетамол')).toBe(0);
  });
  it('equals the other length when one side is empty', () => {
    expect(OSA.distance('', 'парацетамол')).toBe(11);
    expect(Levenshtein.distance('парацетамол', '')).toBe(11);
  });
  it('costs 1 for an adjacent transposition under OSA but 2 under Levenshtein', () => {
    expect(OSA.distance('ab', 'ba')).toBe(1);
    expect(Levenshtein.distance('ab', 'ba')).toBe(2);
  });
  it('normalized_similarity is 1 for identical non-empty strings and 0 for maximally different', () => {
    expect(OSA.normalizedSimilarity('парацетамол', 'парацетамол')).toBe(1);
    expect(OSA.normalizedSimilarity('aaaa', 'bbbb')).toBe(0);
  });
  it('dispatches to the bit-parallel path at exactly 64 units and the DP fallback just above it', () => {
    const a64 = 'а'.repeat(64);
    const b64 = `${'а'.repeat(63)}б`;
    expect(OSA.distance(a64, b64)).toBe(1);
    expect(Levenshtein.distance(a64, b64)).toBe(1);
    const a65 = 'а'.repeat(65);
    const b65 = `${'а'.repeat(64)}б`;
    expect(OSA.distance(a65, b65)).toBe(1);
    expect(Levenshtein.distance(a65, b65)).toBe(1);
  });
  it('bit-parallel and DP implementations agree directly (both directions of dispatch)', () => {
    const pairs: [string, string][] = [
      ['парацетамол', 'парацетомол'],
      ['а'.repeat(64), 'б'.repeat(64)],
      ['', 'а'.repeat(40)],
      ['абвгдежз', 'ижзабвгд'],
    ];
    for (const [a, b] of pairs) {
      expect(internal.osaBitParallel(a, b)).toBe(internal.osaDp(a, b));
      expect(internal.levenshteinBitParallel(a, b)).toBe(internal.levenshteinDp(a, b));
    }
  });
});

describe('extract/extractTop', () => {
  const choices = ['парацетамол', 'цефтриаксон', 'амоксициллин', 'ацикловир', 'кеторол'];

  it('extract drops matches below scoreCutoff and sorts by descending score', () => {
    const matches = extract('парацетомол', choices, { scoreCutoff: 0.5 });
    expect(matches[0]?.choice).toBe('парацетамол');
    expect(matches.every((m) => m.score >= 0.5)).toBe(true);
    for (let i = 1; i < matches.length; i += 1) {
      expect((matches[i - 1]?.score ?? 0) >= (matches[i]?.score ?? 0)).toBe(true);
    }
  });

  it('extractTop matches extract truncated to the same limit', () => {
    const full = extract('парацетомол', choices, { scoreCutoff: 0 });
    const top2 = extractTop('парацетомол', choices, 2, { scoreCutoff: 0 });
    expect(top2).toEqual(full.slice(0, 2));
  });

  it('extractTop agrees with extract over a larger random choice list', () => {
    const big = Array.from({ length: 500 }, (_, i) => `слово${i}вариант`);
    const full = extract('слово42вариант', big, { scoreCutoff: 0.3, limit: 10 });
    const top = extractTop('слово42вариант', big, 10, { scoreCutoff: 0.3 });
    expect(top).toEqual(full);
  });

  it('supports a processor to score non-string choices', () => {
    const items = [{ name: 'Парацетамол' }, { name: 'Цефтриаксон' }];
    const matches = extract('парацетамол', items, {
      processor: (item) => item.name.toLowerCase(),
    });
    expect(matches[0]?.choice.name).toBe('Парацетамол');
  });

  it('extractTop(0) returns nothing', () => {
    expect(extractTop('x', choices, 0)).toEqual([]);
  });
});
