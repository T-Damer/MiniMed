import { describe, expect, it } from 'vitest';
import { ATOM_FEED, JSON_FEED, RSS1_RDF_FEED, RSS2_FEED } from '@/features/news/feed-fixtures';
import {
  DEFAULT_FEED_LIMITS,
  FeedParseError,
  parseFeed,
  parseFeedDate,
} from '@/features/news/feed-parser';

describe('parseFeed RSS 2.0', () => {
  const feed = parseFeed(RSS2_FEED, { baseUrl: 'https://example.org/feed.xml' });

  it('reads the channel and drops duplicate items', () => {
    expect(feed.format).toBe('rss');
    expect(feed.title).toBe('Тестовая лента & новости');
    expect(feed.siteUrl).toBe('https://example.org/');
    expect(feed.language).toBe('ru');
    expect(feed.items).toHaveLength(2);
  });

  it('decodes titles, takes the date, author and guid', () => {
    const first = feed.items[0];
    expect(first?.title).toBe('Первая запись: "ВОЗ"');
    expect(first?.guid).toBe('news_1');
    expect(first?.author).toBe('Иван Петров');
    expect(first?.publishedAt).toBe(Date.parse('2026-10-05T07:30:00Z'));
    expect(first?.url).toBe('https://example.org/news/1');
  });

  it('keeps the description as the snippet and a sanitized body without scripts', () => {
    const first = feed.items[0];
    expect(first?.snippet).toBe('Краткое описание записи.');
    const serialized = JSON.stringify(first?.content);
    expect(serialized).not.toContain('alert');
    expect(serialized).not.toContain('script');
    expect(serialized).toContain('https://example.org/news/1/full');
  });

  it('prefers the media thumbnail for the image', () => {
    expect(feed.items[0]?.imageUrl).toBe('https://example.org/thumb.jpg');
    expect(feed.items[1]?.imageUrl).toBeUndefined();
  });

  it('uses a permalink guid as the link when the item has none', () => {
    const parsed = parseFeed(
      '<rss><channel><item><title>T</title><guid>https://x.example/p/1</guid></item></channel></rss>',
    );
    expect(parsed.items[0]?.url).toBe('https://x.example/p/1');
  });
});

describe('parseFeed RSS 1.0 (RDF) and Atom', () => {
  it('reads items that are siblings of the channel', () => {
    const feed = parseFeed(RSS1_RDF_FEED);
    expect(feed.title).toBe('Journal of Tests: Table of Contents');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.url).toBe('https://journal.example/doi/10.1000/abc');
    expect(feed.items[0]?.publishedAt).toBe(Date.parse('2026-10-03T12:00:00Z'));
    expect(feed.items[0]?.author).toBe('A. Author');
  });

  it('reads Atom entries, the alternate link, escaped html titles and text content', () => {
    const feed = parseFeed(ATOM_FEED);
    expect(feed.format).toBe('atom');
    expect(feed.title).toBe('PLOS Test');
    expect(feed.siteUrl).toBe('https://atom.example/');
    expect(feed.language).toBe('en');
    expect(feed.items).toHaveLength(2);
    const [first, second] = feed.items;
    expect(first?.title).toBe('Mortality <among> children');
    expect(first?.url).toBe('https://atom.example/articles/1');
    expect(first?.author).toBe('Dr. Atom');
    expect(first?.publishedAt).toBe(Date.parse('2026-09-30T09:00:00Z'));
    expect(second?.url).toBeUndefined();
    expect(second?.snippet).toBe('Plain <content>');
  });
});

describe('parseFeed JSON Feed', () => {
  it('reads items, authors and images and skips non-object entries', () => {
    const feed = parseFeed(JSON_FEED);
    expect(feed.format).toBe('json');
    expect(feed.title).toBe('JSON Test Feed');
    expect(feed.siteUrl).toBe('https://json.example/');
    expect(feed.items).toHaveLength(2);
    expect(feed.skipped).toBe(1);
    expect(feed.items[0]?.author).toBe('J. Son');
    expect(feed.items[0]?.imageUrl).toBe('https://json.example/a1.png');
    expect(feed.items[1]?.snippet).toBe('a < b & c');
  });

  it('rejects JSON that is not a JSON Feed', () => {
    expect(() => parseFeed('{"hello":1}')).toThrowError(FeedParseError);
    expect(() => parseFeed('{broken')).toThrowError(/JSON/u);
  });
});

describe('parseFeed bad input', () => {
  const code = (text: string): string | undefined => {
    try {
      parseFeed(text);
    } catch (error) {
      return error instanceof FeedParseError ? error.code : 'other';
    }
    return undefined;
  };

  it('classifies empty, html, plain text and a channel-less rss', () => {
    expect(code('   ')).toBe('empty');
    expect(code('<!DOCTYPE html><html><body>nope</body></html>')).toBe('not-a-feed');
    expect(code('just words')).toBe('not-a-feed');
    expect(code('<rss version="2.0"></rss>')).toBe('malformed');
  });

  it('refuses a body over the size limit before parsing it', () => {
    const huge = `<rss><channel>${'x'.repeat(DEFAULT_FEED_LIMITS.maxChars + 1)}</channel></rss>`;
    expect(code(huge)).toBe('too-large');
  });

  it('survives an unclosed tag, bare ampersands and control characters', () => {
    const feed = parseFeed(
      '﻿<rss><channel><title>A & B\u0001</title><item><title>Tom & Jerry<link>https://x.example/1</link></item></channel>',
    );
    expect(feed.title).toBe('A & B');
    expect(feed.items).toHaveLength(1);
  });

  it('caps the number of items taken from one fetch', () => {
    const items = Array.from(
      { length: 150 },
      (_, index) => `<item><title>Item ${index}</title><guid>g${index}</guid></item>`,
    ).join('');
    const feed = parseFeed(`<rss><channel><title>Big</title>${items}</channel></rss>`);
    expect(feed.items).toHaveLength(DEFAULT_FEED_LIMITS.maxItems);
  });

  it('drops entries with nothing to show and counts them', () => {
    const feed = parseFeed(
      '<rss><channel><item></item><item><title>Real</title></item></channel></rss>',
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.skipped).toBe(1);
  });

  it('does not expand entity declarations', () => {
    const feed = parseFeed(
      '<!DOCTYPE rss [<!ENTITY x "AAAAAAAAAA">]><rss><channel><title>&x;&x;</title><item><title>T</title></item></channel></rss>',
    );
    expect(feed.title).toBe('&x;&x;');
  });
});

describe('parseFeedDate', () => {
  it('reads RFC 822, ISO 8601 and spaced datetimes, and rejects garbage', () => {
    expect(parseFeedDate('Mon, 05 Oct 2026 22:52:31 +0300')).toBe(
      Date.parse('2026-10-05T19:52:31Z'),
    );
    expect(parseFeedDate('2026-10-05T10:00:00Z')).toBe(Date.parse('2026-10-05T10:00:00Z'));
    expect(parseFeedDate('2026-10-05 10:00:00')).toBeTypeOf('number');
    expect(parseFeedDate('not a date')).toBeUndefined();
    expect(parseFeedDate('')).toBeUndefined();
  });
});
