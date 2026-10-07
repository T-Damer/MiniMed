import { describe, expect, it } from 'vitest';
import {
  createUserScrollTracker,
  isScrollKey,
  popupPointForText,
  USER_SCROLL_WINDOW_MS,
} from '@/features/library/epub-popup-anchor';

describe('createUserScrollTracker', () => {
  it('treats a scroll right after a gesture as the reader’s own, a later one as the book’s', () => {
    const tracker = createUserScrollTracker();
    expect(tracker.isUserScroll(1_000)).toBe(false);
    tracker.mark(1_000);
    expect(tracker.isUserScroll(1_000 + USER_SCROLL_WINDOW_MS)).toBe(true);
    expect(tracker.isUserScroll(1_001 + USER_SCROLL_WINDOW_MS)).toBe(false);
  });
});

describe('isScrollKey', () => {
  it('knows the keys that scroll a page', () => {
    expect(isScrollKey('PageDown')).toBe(true);
    expect(isScrollKey(' ')).toBe(true);
    expect(isScrollKey('a')).toBe(false);
  });
});

describe('popupPointForText', () => {
  const viewport = { width: 390, height: 844 };

  it('puts the popup above the middle of the text, in page coordinates', () => {
    expect(
      popupPointForText(
        { left: 10, top: 100 },
        { left: 20, top: 50, width: 40, height: 20 },
        viewport,
      ),
    ).toEqual({ x: 50, y: 150 });
  });

  it('gives up when the text is gone or off screen', () => {
    expect(
      popupPointForText({ left: 0, top: 0 }, { left: 0, top: 0, width: 0, height: 0 }, viewport),
    ).toBeNull();
    expect(
      popupPointForText(
        { left: 0, top: -900 },
        { left: 0, top: 10, width: 40, height: 20 },
        viewport,
      ),
    ).toBeNull();
    expect(
      popupPointForText(
        { left: 0, top: 900 },
        { left: 0, top: 10, width: 40, height: 20 },
        viewport,
      ),
    ).toBeNull();
  });
});
