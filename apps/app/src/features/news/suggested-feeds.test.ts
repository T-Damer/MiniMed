import { describe, expect, it } from 'vitest';
import {
  isSuggestedFeed,
  SUGGESTED_FEEDS,
  suggestedFeedById,
  unsubscribedSuggestions,
} from '@/features/news/suggested-feeds';
import suggestedFeedData from '@/features/news/suggested-feeds.json';

describe('suggested sources data', () => {
  it('every entry of the JSON passes validation, so none is silently dropped', () => {
    expect(SUGGESTED_FEEDS).toHaveLength(suggestedFeedData.feeds.length);
    expect(suggestedFeedData.feeds.every((feed) => isSuggestedFeed(feed))).toBe(true);
  });

  it('has unique ids and addresses, a topic and a bundled visual for each source', () => {
    expect(new Set(SUGGESTED_FEEDS.map((feed) => feed.id)).size).toBe(SUGGESTED_FEEDS.length);
    expect(new Set(SUGGESTED_FEEDS.map((feed) => feed.url)).size).toBe(SUGGESTED_FEEDS.length);
    for (const feed of SUGGESTED_FEEDS) {
      expect(feed.topic.length).toBeGreaterThan(0);
      expect(feed.visual.mark.length).toBeLessThanOrEqual(4);
    }
  });

  it('declares no remote picture: a suggestion must not cause a request before subscribing', () => {
    const text = JSON.stringify(suggestedFeedData.feeds);
    expect(text).not.toMatch(/favicon|logo|icon|"image"/iu);
    for (const feed of suggestedFeedData.feeds) {
      expect(Object.keys(feed)).not.toContain('logo');
    }
  });

  it('rejects a visual with an unknown glyph, an out-of-range hue or a long mark', () => {
    const base = SUGGESTED_FEEDS[0];
    expect(base).toBeDefined();
    expect(isSuggestedFeed({ ...base, visual: { ...base?.visual, glyph: 'no-such-glyph' } })).toBe(
      false,
    );
    expect(isSuggestedFeed({ ...base, visual: { ...base?.visual, hue: 400 } })).toBe(false);
    expect(isSuggestedFeed({ ...base, visual: { ...base?.visual, mark: 'ABCDE' } })).toBe(false);
    expect(isSuggestedFeed({ ...base, carriesImages: 'yes' })).toBe(false);
  });

  it('marks the sources measured to carry pictures, and lists only the unsubscribed ones', () => {
    expect(suggestedFeedById('stat-news')?.carriesImages).toBe(true);
    expect(suggestedFeedById('who-news-ru')?.carriesImages).toBe(false);
    expect(suggestedFeedById(undefined)).toBeUndefined();
    const first = SUGGESTED_FEEDS[0];
    const remaining = unsubscribedSuggestions(new Set(first ? [first.url] : []));
    expect(remaining).toHaveLength(SUGGESTED_FEEDS.length - 1);
    expect(remaining.some((feed) => feed.id === first?.id)).toBe(false);
  });
});
