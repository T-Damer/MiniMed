import { describe, expect, it } from 'vitest';

import { buildSnippet } from '../src/snippet';

describe('snippet highlighting', () => {
  it('maps normalized matches back to original text offsets', () => {
    const result = buildSnippet('Кашель.   Часто дышит.', ['часто дышит'], Number.MAX_SAFE_INTEGER);

    expect(result.text).toBe('Кашель.   Часто дышит.');
    expect(result.ranges).toEqual([{ start: 10, end: 21 }]);
    expect(result.text.slice(result.ranges[0]?.start ?? 0, result.ranges[0]?.end ?? 0)).toBe(
      'Часто дышит',
    );
  });
});
