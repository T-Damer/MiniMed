import { describe, expect, it } from 'vitest';

import { validateLocalRankingResponse } from './local-reranker-contract';

const candidates = [
  { id: 'a', text: 'Source a', strictIdentity: false },
  { id: 'b', text: 'Source b', strictIdentity: false },
];
const response = {
  schemaVersion: 1,
  status: 'observe',
  orderedIds: ['a', 'b'],
  experimentalIds: ['b', 'a'],
  applied: false,
  inferenceMs: 3,
};

describe('local classifier boundary', () => {
  it('keeps observe mode separate from the displayed deterministic order', () => {
    expect(validateLocalRankingResponse(response, candidates, false).orderedIds).toEqual(['a', 'b']);
  });

  it.each([
    ['invented', ['a', 'invented']],
    ['duplicate', ['a', 'a']],
    ['dropped', ['a']],
    ['added', ['a', 'b', 'c']],
    ['wrong-type', ['a', 7]],
  ])('rejects %s source identities', (_, ids) => {
    expect(() =>
      validateLocalRankingResponse({ ...response, experimentalIds: ids }, candidates, false),
    ).toThrow('permutation');
  });

  it('rejects unrequested application', () => {
    expect(() =>
      validateLocalRankingResponse(
        { ...response, applied: true, status: 'experimental', orderedIds: ['b', 'a'] },
        candidates,
        false,
      ),
    ).toThrow('protection');
  });

  it('rejects a reordered observe response', () => {
    expect(() =>
      validateLocalRankingResponse({ ...response, orderedIds: ['b', 'a'] }, candidates, false),
    ).toThrow('protection');
  });

  it('preserves strict identities even with explicit experimental permission', () => {
    expect(() =>
      validateLocalRankingResponse(
        { ...response, applied: true, status: 'experimental', orderedIds: ['b', 'a'] },
        [{ ...candidates[0]!, strictIdentity: true }, candidates[1]!],
        true,
      ),
    ).toThrow('protection');
  });

  it.each([NaN, Infinity, -1, '3'])('rejects invalid time %s', (inferenceMs) => {
    expect(() =>
      validateLocalRankingResponse({ ...response, inferenceMs }, candidates, false),
    ).toThrow('metadata');
  });

  it('accepts fallback only with the original experimental order', () => {
    expect(() =>
      validateLocalRankingResponse({ ...response, status: 'fallback' }, candidates, false),
    ).toThrow('protection');
  });

  it('accepts explicitly requested clinical ordering', () => {
    expect(
      validateLocalRankingResponse(
        { ...response, applied: true, status: 'experimental', orderedIds: ['b', 'a'] },
        candidates,
        true,
      ).orderedIds,
    ).toEqual(['b', 'a']);
  });
});
