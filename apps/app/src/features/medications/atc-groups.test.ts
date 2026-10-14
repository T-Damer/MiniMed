import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { atcGroups, atcMatchOf, singleAtcGroup, singleByCode } from './atc-groups';
import { atcMatchLabel } from './atc-match-label';

function group(documentId: string, code?: string): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: [],
    results: [],
    ...(code ? { atcMatch: { code } } : {}),
  };
}

describe('reading the answer of the code search', () => {
  const groups = [group('a', 'J05AB01'), group('b', 'J05AB11'), group('text-hit')];

  it('keeps the groups the code found, in order', () => {
    expect(atcGroups(groups).map((item) => item.documentId)).toEqual(['a', 'b']);
  });

  it('names a drug by a full code, and by a prefix only when it holds one drug', () => {
    expect(singleAtcGroup('J05AB01', groups)?.documentId).toBe('a');
    expect(singleAtcGroup('J05', groups)).toBeNull();
    expect(singleAtcGroup('J05', [group('only', 'J05AB01'), group('text-hit')])?.documentId).toBe(
      'only',
    );
    expect(singleAtcGroup('J05AB01', [group('text-hit')])).toBeNull();
  });

  it('names nothing for a text that is not a code', () => {
    expect(singleAtcGroup('ацикловир', groups)).toBeNull();
    expect(singleByCode('С3', ['x'])).toBeNull();
  });

  it('carries the match as an optional property', () => {
    expect(atcMatchOf(group('a', 'J05AB01'))).toEqual({ atc: { code: 'J05AB01' } });
    expect(atcMatchOf(group('b'))).toEqual({});
  });
});

describe('atcMatchLabel', () => {
  it('words an agreed code as the drug screen does', () => {
    expect(atcMatchLabel({ code: 'J05AX13', registryCode: 'L03AX' })).toEqual({
      code: 'J05AX13',
      registryNote: 'в реестре: L03AX',
    });
    expect(atcMatchLabel({ code: 'M01AE01' })).toEqual({ code: 'M01AE01', registryNote: null });
  });
});
