import { describe, expect, it } from 'vitest';
import { extract, extractTop, internal, Levenshtein, OSA } from './rapidfuzz';
import { isRapidfuzzWasmReady, wasmExtractTopStrings, wasmPairDistance } from './rapidfuzz-wasm';

describe('rapidfuzz WASM kernels', () => {
  it('loads the standalone WASM module synchronously', () => {
    expect(isRapidfuzzWasmReady()).toBe(true);
  });

  it('matches pure-TS DP oracle for Cyrillic, Latin, transpositions, and >64-char strings', () => {
    const pairs: readonly [string, string][] = [
      ['', ''],
      ['амоксициллин', 'амоксициллин'],
      ['амоксицилин', 'амоксициллин'],
      ['ибпурофен', 'ибупрофен'],
      ['атомоксетин', 'атомекситин'],
      ['рисперидон', 'рисперадон'],
      ['цефтриаксон', 'цефтриаксон натрия'],
      ['nurofen', 'nurfoen'],
      ['a'.repeat(80) + 'bc', 'a'.repeat(80) + 'cb'],
      ['амоксициллин '.repeat(8), 'амоксицилин '.repeat(8)],
    ];
    for (const [left, right] of pairs) {
      expect(wasmPairDistance(left, right, 'osa')).toBe(internal.osaDp(left, right));
      expect(wasmPairDistance(left, right, 'levenshtein')).toBe(
        internal.levenshteinDp(left, right),
      );
      expect(OSA.distance(left, right)).toBe(internal.osaDp(left, right));
      expect(Levenshtein.distance(left, right)).toBe(internal.levenshteinDp(left, right));
    }
  });

  it('matches extract() ordering, tie-breaking, and scoreCutoff in batch extractTop', () => {
    const choices = [
      'амоксициллин',
      'амоксиклав',
      'азитромицин',
      'ампициллин',
      'атомоксетин',
      'аторвастатин',
      'ибупрофен',
      'индапамид',
      'рисперидон',
      'розувастатин',
    ];
    for (const query of ['амоксицилин', 'атомекситин', 'ибпурофен', 'рисперадон']) {
      const wasmOsa = wasmExtractTopStrings(query, choices, 5, 0.5, 'osa');
      const tsOsa = extract(query, choices, {
        scorer: (a, b) => {
          const d = internal.osaDp(a, b);
          const m = Math.max(a.length, b.length);
          return m === 0 ? 1 : 1 - d / m;
        },
        scoreCutoff: 0.5,
        limit: 5,
      });
      expect(wasmOsa).toEqual(tsOsa);
      expect(extractTop(query, choices, 5, { scoreCutoff: 0.5 })).toEqual(tsOsa);

      const wasmLev = wasmExtractTopStrings(query, choices, 5, 0.5, 'levenshtein');
      const tsLev = extract(query, choices, {
        scorer: (a, b) => {
          const d = internal.levenshteinDp(a, b);
          const m = Math.max(a.length, b.length);
          return m === 0 ? 1 : 1 - d / m;
        },
        scoreCutoff: 0.5,
        limit: 5,
      });
      expect(wasmLev).toEqual(tsLev);
      expect(
        extractTop(query, choices, 5, {
          scorer: Levenshtein.normalizedSimilarity,
          scoreCutoff: 0.5,
        }),
      ).toEqual(tsLev);
    }
  });
});
