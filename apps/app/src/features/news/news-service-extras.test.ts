import { describe, expect, it } from 'vitest';

import { RSS2_FEED } from '@/features/news/feed-fixtures';
import { NewsService } from '@/features/news/news-service';
import { createMemoryNewsStorage } from '@/features/news/news-storage';
import {
  FeedFetchError,
  type FeedRequest,
  type FeedResponse,
  type FeedTransport,
} from '@/features/news/news-transport';
import type { NewsItem } from '@/features/news/news-types';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PNG_DATA = 'data:image/png;base64,iVBORwECAwQ=';
const FEED_URL = 'https://example.org/feed.xml';
const PARAGRAPH =
  'Подробный текст статьи про клинические рекомендации, с запятыми, цифрами и выводами, который достаточно длинный для выделения.';
const PAGE = `<html><head><link rel="apple-touch-icon" href="/touch.png"><title>t</title></head><body><article><h1>Заголовок статьи</h1><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p></article></body></html>`;

type Handler = (request: FeedRequest) => FeedResponse | Promise<FeedResponse>;

function reply(request: FeedRequest, init: Partial<FeedResponse> = {}): FeedResponse {
  return {
    status: 200,
    notModified: false,
    text: '',
    finalUrl: request.url,
    headers: {},
    ...init,
  };
}

function build(handler: Handler, options: { fetchIcons?: boolean; online?: () => boolean } = {}) {
  const requests: FeedRequest[] = [];
  const transport: FeedTransport = {
    kind: 'native',
    conditional: true,
    fetch: async (request) => {
      requests.push(request);
      return handler(request);
    },
  };
  const storage = createMemoryNewsStorage();
  const service = new NewsService({
    storage,
    transport,
    now: () => NOW,
    online: options.online ?? (() => true),
    fetchIcons: options.fetchIcons ?? false,
    shrinkIcon: undefined,
  });
  return { service, requests, storage };
}

const siteHandler: Handler = (request) => {
  if (request.url === FEED_URL) return reply(request, { text: RSS2_FEED });
  if (request.url.endsWith('/touch.png')) return reply(request, { bytes: PNG });
  return reply(request, { text: PAGE });
};

describe('NewsService.markReadMany', () => {
  it('marks several items read with one write per feed and updates the counter', async () => {
    const { service } = build(siteHandler);
    await service.subscribeFeed(FEED_URL);
    const ids = service.snapshot().items.map((item) => item.id);
    expect(service.snapshot().unread).toBeGreaterThan(0);
    await service.markReadMany(ids.slice(0, 1));
    expect(service.snapshot().items.filter((item) => item.read)).toHaveLength(1);
    await service.markReadMany([...ids, 'unknown']);
    expect(service.snapshot().unread).toBe(0);
    await service.markReadMany([]);
    expect(service.snapshot().unread).toBe(0);
  });
});

describe('NewsService avatars', () => {
  it('fetches the site icon after subscribing, keeps it by host and does not ask again', async () => {
    const { service, requests, storage } = build(siteHandler, { fetchIcons: true });
    await service.subscribeFeed(FEED_URL);
    await service.settleIcons();
    expect(service.snapshot().icons['example.org']).toBe(PNG_DATA);
    expect(storage.loadIcons()['example.org']?.data).toBe(PNG_DATA);
    const before = requests.length;
    await service.refresh();
    await service.settleIcons();
    // The refresh fetched the feed only: the avatar is known.
    expect(requests.length - before).toBe(1);
  });

  it('records a failed attempt so the monogram is not retried on every refresh', async () => {
    const { service, requests } = build(
      (request) => {
        if (request.url === FEED_URL) return reply(request, { text: RSS2_FEED });
        throw new FeedFetchError('http', 'x', 404);
      },
      { fetchIcons: true },
    );
    await service.subscribeFeed(FEED_URL);
    await service.settleIcons();
    expect(service.snapshot().icons).toEqual({});
    const before = requests.length;
    await service.refresh();
    await service.settleIcons();
    expect(requests.length - before).toBe(1);
  });

  it('does not touch the network for avatars unless asked, nor while offline', async () => {
    const quiet = build(siteHandler);
    await quiet.service.subscribeFeed(FEED_URL);
    await quiet.service.settleIcons();
    expect(quiet.requests).toHaveLength(1);
    let online = true;
    const offline = build(siteHandler, { fetchIcons: true, online: () => online });
    await offline.service.subscribeFeed(FEED_URL);
    await offline.service.settleIcons();
    online = false;
    offline.requests.length = 0;
    await offline.service.refresh();
    await offline.service.settleIcons();
    expect(offline.requests).toHaveLength(0);
  });

  it('keeps an avatar fetched for the preview and drops it with the last source of the host', async () => {
    const { service } = build(siteHandler);
    await service.subscribeFeed(FEED_URL, { icon: PNG_DATA });
    expect(service.snapshot().icons['example.org']).toBe(PNG_DATA);
    const id = service.snapshot().subscriptions[0]?.id ?? '';
    await service.remove(id);
    expect(service.snapshot().icons).toEqual({});
  });

  it('refuses stored avatars that are not small image data URLs', async () => {
    const { service } = build(siteHandler);
    await service.subscribeFeed(FEED_URL, { icon: 'data:text/html;base64,PHNjcmlwdD4=' });
    expect(service.snapshot().icons).toEqual({});
  });
});

describe('NewsService articles', () => {
  async function firstItem(service: NewsService): Promise<NewsItem> {
    await service.subscribeFeed(FEED_URL);
    const item = service.snapshot().items.find((entry) => entry.url);
    if (!item) throw new Error('fixture has no item with a link');
    return item;
  }

  it('downloads the page, extracts the article and keeps it for offline reading', async () => {
    const { service, storage } = build(siteHandler);
    const item = await firstItem(service);
    const article = await service.downloadArticle(item);
    expect(article?.title).toBe('Заголовок статьи');
    expect(JSON.stringify(article?.content)).toContain('Подробный текст статьи');
    expect((await service.cachedArticle(item.id))?.itemId).toBe(item.id);
    expect((await storage.loadArticle(item.id))?.url).toBe(item.url);
  });

  it('reuses the page for the raw view and downloads it once', async () => {
    const { service, requests } = build(siteHandler);
    const item = await firstItem(service);
    await service.downloadArticle(item);
    const before = requests.length;
    const page = await service.fetchPage(item.url ?? '');
    expect(page.html).toContain('<article>');
    expect(requests.length).toBe(before);
  });

  it('says nothing was extracted for a page without an article', async () => {
    const { service } = build((request) =>
      request.url === FEED_URL
        ? reply(request, { text: RSS2_FEED })
        : reply(request, { text: '<html><body><p>Коротко.</p></body></html>' }),
    );
    const item = await firstItem(service);
    expect(await service.downloadArticle(item)).toBeUndefined();
    expect(await service.cachedArticle(item.id)).toBeUndefined();
  });

  it('sends nothing while offline and passes a browser refusal through', async () => {
    let online = true;
    const offline = build(siteHandler, { online: () => online });
    const item = await firstItem(offline.service);
    online = false;
    await expect(offline.service.downloadArticle(item)).rejects.toMatchObject({ code: 'offline' });
    const blocked = build((request) => {
      if (request.url === FEED_URL) return reply(request, { text: RSS2_FEED });
      throw new FeedFetchError('cors', 'blocked');
    });
    const other = await firstItem(blocked.service);
    await expect(blocked.service.downloadArticle(other)).rejects.toMatchObject({ code: 'cors' });
  });

  it('drops the articles of items that are no longer kept, and of a removed source', async () => {
    const { service, storage } = build(siteHandler);
    const item = await firstItem(service);
    await service.downloadArticle(item);
    await service.remove(item.feedId);
    expect(await storage.loadArticle(item.id)).toBeUndefined();
  });
});
