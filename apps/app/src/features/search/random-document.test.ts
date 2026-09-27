import { describe, expect, it } from 'vitest';

import { pickRandomDocument } from '@/features/search/random-document';

describe('random document', () => {
  const documents = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('covers the whole section, first to last', () => {
    expect(pickRandomDocument(documents, () => 0)?.id).toBe('a');
    expect(pickRandomDocument(documents, () => 0.5)?.id).toBe('b');
    expect(pickRandomDocument(documents, () => 0.999_999)?.id).toBe('c');
  });

  it('has nothing to open in an empty section', () => {
    expect(pickRandomDocument([], () => 0.5)).toBeUndefined();
  });
});
