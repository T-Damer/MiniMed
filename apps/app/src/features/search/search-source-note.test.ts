import { describe, expect, it } from 'vitest';

import { sourceMaterialsLabel, sourceNoteText } from '@/features/search/search-source-note';

const NBSP = ' ';

describe('source note', () => {
  it('counts materials with the right noun form', () => {
    expect(sourceMaterialsLabel(1)).toBe(`1${NBSP}материал`);
    expect(sourceMaterialsLabel(3)).toBe(`3${NBSP}материала`);
    expect(sourceMaterialsLabel(25)).toBe(`25${NBSP}материалов`);
    expect(sourceMaterialsLabel(21)).toBe(`21${NBSP}материал`);
    expect(sourceMaterialsLabel(6068)).toMatch(new RegExp(`^6.068${NBSP}материалов$`, 'u'));
  });

  it('names the source with its size, or with the words searched inside it', () => {
    const scope = { id: 'x', label: 'Красота и медицина', documentCount: 3, remainder: '' };
    expect(sourceNoteText(scope)).toBe(`Красота и медицина · 3${NBSP}материала`);
    expect(sourceNoteText({ ...scope, remainder: 'пневмония' })).toBe(
      'Красота и медицина · «пневмония»',
    );
  });
});
