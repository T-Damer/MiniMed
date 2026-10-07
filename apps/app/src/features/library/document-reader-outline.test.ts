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

  it('computeReadingLine stays below the sticky headings a jump aligns sections to', () => {
    // A section aligned to a 182px scroll margin must count as read: the line cannot be at 120px.
    expect(computeReadingLine({ top: 0, height: 844 } as DOMRect, 186)).toBe(186);
    expect(computeReadingLine({ top: 0, height: 844 } as DOMRect, 60)).toBe(120);
    expect(computeReadingLine({ top: 100, height: 400 } as DOMRect, 0)).toBe(180);
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
