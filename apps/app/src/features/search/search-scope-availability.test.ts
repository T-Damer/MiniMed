import { describe, expect, it } from 'vitest';

import { canSelectSearchScope } from '@/features/search/search-scope-availability';

describe('search scope availability', () => {
  it('keeps medications selectable when document search has no installed sources', () => {
    expect(canSelectSearchScope('medications', true, 0)).toBe(true);
  });

  it('disables other empty scopes after document counts are loaded', () => {
    expect(canSelectSearchScope('guidelines', true, 0)).toBe(false);
    expect(canSelectSearchScope('legal', true, 0)).toBe(false);
  });

  it('allows scopes before counts load and whenever documents exist', () => {
    expect(canSelectSearchScope('guidelines', false, 0)).toBe(true);
    expect(canSelectSearchScope('guidelines', true, 1)).toBe(true);
  });
});
