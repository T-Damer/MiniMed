import { describe, expect, it, vi } from 'vitest';

import {
  bytesToDataUrl,
  fetchSourceIcon,
  iconCandidates,
  iconKeyFor,
  isStoredIconData,
  MAX_ICON_DATA_CHARS,
  sniffImageKind,
} from '@/features/news/news-icons';
import {
  FeedFetchError,
  type FeedRequest,
  type FeedResponse,
  type FeedTransport,
} from '@/features/news/news-transport';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const HEAD = `<html><head>
  <link rel="icon" href="/small.png" sizes="16x16">
  <link rel="shortcut icon" href="/favicon-96.png" sizes="96x96">
  <link rel="apple-touch-icon" href="/touch-180.png" sizes="180x180">
  <link rel="stylesheet" href="/site.css">
  <link rel="icon" href="javascript:alert(1)">
</head><body></body></html>`;

function transportOf(
  handler: (request: FeedRequest) => FeedResponse | Promise<FeedResponse>,
): FeedTransport {
  return { kind: 'native', conditional: true, fetch: async (request) => handler(request) };
}

function response(init: Partial<FeedResponse> & { finalUrl: string }): FeedResponse {
  return { status: 200, notModified: false, text: '', headers: {}, ...init };
}

describe('sniffImageKind', () => {
  it('recognises images by their bytes, not by what the server says', () => {
    expect(sniffImageKind(PNG)).toBe('png');
    expect(sniffImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageKind(new TextEncoder().encode('GIF89a'))).toBe('gif');
    expect(sniffImageKind(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('ico');
    expect(sniffImageKind(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe(
      'webp',
    );
    expect(sniffImageKind(new TextEncoder().encode('  <svg xmlns="x"></svg>'))).toBe('svg');
    expect(sniffImageKind(new TextEncoder().encode('<!doctype html><html>'))).toBeUndefined();
  });
});

describe('isStoredIconData', () => {
  it('accepts only small base64 image data URLs', () => {
    expect(isStoredIconData(bytesToDataUrl(PNG, 'png'))).toBe(true);
    expect(isStoredIconData('data:text/html;base64,AAAA')).toBe(false);
    expect(isStoredIconData('https://x.test/i.png')).toBe(false);
    expect(isStoredIconData(`data:image/png;base64,${'A'.repeat(MAX_ICON_DATA_CHARS)}`)).toBe(
      false,
    );
    expect(isStoredIconData(undefined)).toBe(false);
  });
});

describe('iconCandidates', () => {
  it('ranks apple-touch-icon first, then sized icons near 128 px, then the feed image and favicon.ico', () => {
    expect(iconCandidates(HEAD, 'https://news.test/a/', 'https://cdn.test/feed.png')).toEqual([
      'https://news.test/touch-180.png',
      'https://news.test/favicon-96.png',
      'https://news.test/small.png',
      'https://cdn.test/feed.png',
    ]);
  });

  it('falls back to favicon.ico for a page without icon links, and drops non-http links', () => {
    expect(iconCandidates('<html><head></head></html>', 'https://news.test/')).toEqual([
      'https://news.test/favicon.ico',
    ]);
  });
});

describe('fetchSourceIcon', () => {
  it('reads the home page, then downloads the best icon and shrinks it', async () => {
    const seen: string[] = [];
    const transport = transportOf((request) => {
      seen.push(request.url);
      if (request.url === 'https://news.test/') {
        return response({ finalUrl: 'https://news.test/', text: HEAD });
      }
      return response({ finalUrl: request.url, bytes: PNG });
    });
    const shrink = vi.fn(async () => 'data:image/png;base64,QUJD');
    const icon = await fetchSourceIcon({ transport, shrink, siteUrl: 'https://news.test/' });
    expect(icon).toBe('data:image/png;base64,QUJD');
    expect(seen).toEqual(['https://news.test/', 'https://news.test/touch-180.png']);
    expect(shrink).toHaveBeenCalledWith(PNG, 'png');
  });

  it('moves on from a candidate that is not an image or cannot be fetched', async () => {
    const transport = transportOf((request) => {
      if (request.url === 'https://news.test/') {
        return response({ finalUrl: request.url, text: HEAD });
      }
      if (request.url.endsWith('touch-180.png')) {
        return response({ finalUrl: request.url, bytes: new TextEncoder().encode('<html>') });
      }
      if (request.url.endsWith('favicon-96.png')) throw new FeedFetchError('http', 'x', 404);
      return response({ finalUrl: request.url, bytes: PNG });
    });
    const icon = await fetchSourceIcon({ transport, siteUrl: 'https://news.test/' });
    expect(icon).toBe(bytesToDataUrl(PNG, 'png'));
  });

  it('still tries favicon.ico when the home page is unreadable, and gives up quietly', async () => {
    const seen: string[] = [];
    const transport = transportOf((request) => {
      seen.push(request.url);
      throw new FeedFetchError('cors', 'x');
    });
    expect(await fetchSourceIcon({ transport, siteUrl: 'https://news.test/' })).toBeUndefined();
    expect(seen).toEqual(['https://news.test/', 'https://news.test/favicon.ico']);
  });

  it('does not store an icon the shrinker could not decode', async () => {
    const transport = transportOf((request) =>
      request.url === 'https://news.test/'
        ? response({ finalUrl: request.url, text: '<html></html>' })
        : response({ finalUrl: request.url, bytes: PNG }),
    );
    const icon = await fetchSourceIcon({
      transport,
      shrink: async () => undefined,
      siteUrl: 'https://news.test/',
    });
    expect(icon).toBeUndefined();
  });
});

describe('iconKeyFor', () => {
  it('keys a source by the host of its site', () => {
    expect(iconKeyFor('https://www.news.test/feed.xml')).toBe('news.test');
  });
});
