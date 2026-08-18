import { describe, expect, it } from 'vitest';
import {
  computeReadingLine,
  outlineItemSelector,
  pickActiveSectionAnchor,
} from '@/features/library/document-reader-outline';

describe('document-reader-outline', () => {
  it('computeReadingLine uses top offset capped at 120px', () => {
    expect(computeReadingLine({ top: 100, height: 400 } as DOMRect)).toBe(180);
    expect(computeReadingLine({ top: 50, height: 1000 } as DOMRect)).toBe(170);
  });

  it('pickActiveSectionAnchor selects the last section above the reading line', () => {
    const sections = [
      { id: 'a', getBoundingClientRect: () => ({ top: 80 }) },
      { id: 'b', getBoundingClientRect: () => ({ top: 150 }) },
      { id: 'c', getBoundingClientRect: () => ({ top: 220 }) },
    ] as HTMLElement[];

    expect(pickActiveSectionAnchor(sections, 100)).toBe('a');
    expect(pickActiveSectionAnchor(sections, 160)).toBe('b');
    expect(pickActiveSectionAnchor(sections, 300)).toBe('c');
    expect(pickActiveSectionAnchor([], 100)).toBe('');
  });

  it('outlineItemSelector builds attribute selectors', () => {
    expect(outlineItemSelector('data-section-anchor', 'intro')).toBe(
      '[data-section-anchor="intro"]',
    );
  });
});
