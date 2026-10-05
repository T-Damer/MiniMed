import { describe, expect, it } from 'vitest';

import { HTML_PAGE, RSS2_FEED } from '@/features/news/feed-fixtures';
import {
  classifyPayload,
  discoverFeedLinks,
  hostLabel,
  normalizeSourceUrl,
  pageTitleOf,
} from '@/features/news/source-url';

describe('normalizeSourceUrl', () => {
  it('adds https, trims and drops the fragment', () => {
    expect(normalizeSourceUrl('  example.org/feed.xml#top ')).toEqual({
      ok: true,
      url: 'https://example.org/feed.xml',
    });
    expect(normalizeSourceUrl('//example.org/rss')).toEqual({
      ok: true,
      url: 'https://example.org/rss',
    });
    expect(normalizeSourceUrl('http://example.org/rss')).toEqual({
      ok: true,
      url: 'http://example.org/rss',
    });
  });

  it('turns the old feed:// and rss:// schemes into https', () => {
    expect(normalizeSourceUrl('feed://example.org/rss')).toEqual({
      ok: true,
      url: 'https://example.org/rss',
    });
    expect(normalizeSourceUrl('rss://example.org/rss')).toEqual({
      ok: true,
      url: 'https://example.org/rss',
    });
  });

  it('accepts a host with a port and localhost', () => {
    expect(normalizeSourceUrl('127.0.0.1:4173/feed')).toEqual({
      ok: true,
      url: 'https://127.0.0.1:4173/feed',
    });
    expect(normalizeSourceUrl('localhost:8080/feed')).toMatchObject({ ok: true });
  });

  it('rejects empty input, spaces, other schemes, credentials and bare words', () => {
    expect(normalizeSourceUrl('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(normalizeSourceUrl('two words')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(normalizeSourceUrl('javascript:alert(1)')).toMatchObject({
      ok: false,
      reason: 'scheme',
    });
    expect(normalizeSourceUrl('ftp://example.org/a')).toMatchObject({
      ok: false,
      reason: 'scheme',
    });
    expect(normalizeSourceUrl('https://user:pass@example.org/')).toMatchObject({
      ok: false,
      reason: 'credentials',
    });
    expect(normalizeSourceUrl('justaword')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('classifyPayload', () => {
  it('recognises feeds of every format and pages', () => {
    expect(classifyPayload(RSS2_FEED, 'application/rss+xml')).toBe('feed');
    expect(classifyPayload('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toBe('feed');
    expect(classifyPayload('<rdf:RDF xmlns:rdf="x"></rdf:RDF>')).toBe('feed');
    expect(classifyPayload('{"version":"https://jsonfeed.org/version/1.1","items":[]}')).toBe(
      'feed',
    );
    expect(classifyPayload(HTML_PAGE, 'text/html')).toBe('html');
    expect(classifyPayload('<html><body>x</body></html>')).toBe('html');
  });

  it('does not take a page that merely mentions a feed for a feed', () => {
    expect(
      classifyPayload(
        '<!doctype html><html><head><title>x</title></head><body><rss>no</rss></body></html>',
      ),
    ).toBe('html');
  });

  it('answers unknown for other payloads', () => {
    expect(classifyPayload('{"hello":1}')).toBe('unknown');
    expect(classifyPayload('plain text', 'text/plain')).toBe('unknown');
  });
});

describe('discoverFeedLinks', () => {
  it('lists declared alternates resolved against the page and skips other links', () => {
    expect(discoverFeedLinks(HTML_PAGE, 'https://news.example/section/')).toEqual([
      { url: 'https://news.example/rss.xml', format: 'rss', title: 'Все новости' },
      { url: 'https://news.example/atom', format: 'atom', title: '' },
    ]);
  });

  it('returns nothing for a page without declarations', () => {
    expect(
      discoverFeedLinks('<html><head></head><body></body></html>', 'https://a.example/'),
    ).toEqual([]);
  });

  it('reads the page title and host label', () => {
    expect(pageTitleOf(HTML_PAGE)).toBe('Журнал & сайт');
    expect(hostLabel('https://www.example.org/a')).toBe('example.org');
  });
});
