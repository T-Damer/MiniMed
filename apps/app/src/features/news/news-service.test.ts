import { describe, expect, it } from 'vitest';

import { ATOM_FEED, HTML_PAGE, RSS2_FEED } from '@/features/news/feed-fixtures';
import { NewsService } from '@/features/news/news-service';
import { createMemoryNewsStorage, type NewsStorage } from '@/features/news/news-storage';
import {
  FeedFetchError,
  type FeedRequest,
  type FeedResponse,
  type FeedTransport,
} from '@/features/news/news-transport';

const NOW = Date.parse('2026-10-05T12:00:00Z');

type Handler = (request: FeedRequest) => FeedResponse | Promise<FeedResponse>;

function ok(text: string, headers: Record<string, string> = {}): FeedResponse {
  return {
    status: 200,
    notModified: false,
    text,
    finalUrl: 'https://example.org/feed.xml',
    headers,
  };
}

function makeService(
  handler: Handler,
  options: { online?: () => boolean; storage?: NewsStorage; now?: () => number } = {},
) {
  const requests: FeedRequest[] = [];
  const transport: FeedTransport = {
    kind: 'web',
    conditional: false,
    fetch: async (request) => {
      requests.push(request);
      return handler(request);
    },
  };
  const storage = options.storage ?? createMemoryNewsStorage();
  const service = new NewsService({
    storage,
    transport,
    now: options.now ?? (() => NOW),
    online: options.online ?? (() => true),
  });
  return { service, requests, storage };
}

describe('NewsService offline-first behaviour', () => {
  it('makes no request on load or refresh while nothing is subscribed', async () => {
    const { service, requests } = makeService(() => {
      throw new Error('must not be called');
    });
    await service.load();
    expect(await service.refresh()).toEqual({ offline: false, refreshed: 0, failed: 0, added: 0 });
    expect(await service.refreshStale(1000)).toMatchObject({ refreshed: 0 });
    expect(requests).toHaveLength(0);
    expect(service.snapshot().subscriptions).toEqual([]);
  });

  it('shows cached items after a restart without touching the network', async () => {
    const storage = createMemoryNewsStorage();
    const first = makeService(() => ok(RSS2_FEED), { storage });
    await first.service.subscribeFeed('https://example.org/feed.xml');
    const second = makeService(
      () => {
        throw new Error('offline');
      },
      { storage, online: () => false },
    );
    await second.service.load();
    const snapshot = second.service.snapshot();
    expect(snapshot.itemsLoaded).toBe(true);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.subscriptions[0]?.fetchedAt).toBe(NOW);
    expect(second.requests).toHaveLength(0);
  });

  it('refresh while offline sends nothing and keeps the cache', async () => {
    let online = true;
    const { service, requests } = makeService(() => ok(RSS2_FEED), { online: () => online });
    await service.subscribeFeed('https://example.org/feed.xml');
    online = false;
    const report = await service.refresh();
    expect(report.offline).toBe(true);
    expect(requests).toHaveLength(1);
    expect(service.snapshot().items).toHaveLength(2);
  });
});

describe('NewsService subscriptions', () => {
  it('subscribes, stores items and counts unread', async () => {
    const { service } = makeService(() => ok(RSS2_FEED));
    const subscription = await service.subscribeFeed('https://example.org/feed.xml', {
      suggestedId: 'sug-1',
      language: 'ru',
    });
    expect(subscription.title).toBe('Тестовая лента & новости');
    expect(subscription.suggestedId).toBe('sug-1');
    const snapshot = service.snapshot();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.unread).toBe(subscription.unread);
    expect(snapshot.unread).toBe(snapshot.items.filter((item) => !item.read).length);
  });

  it('does not subscribe twice to the same address', async () => {
    const { service, requests } = makeService(() => ok(RSS2_FEED));
    const first = await service.subscribeFeed('https://example.org/feed.xml');
    const second = await service.subscribeFeed('https://example.org/feed.xml');
    expect(second.id).toBe(first.id);
    expect(requests).toHaveLength(1);
    expect(service.snapshot().subscriptions).toHaveLength(1);
  });

  it('does not subscribe to something that is not a feed', async () => {
    const { service } = makeService(() => ok(HTML_PAGE));
    await expect(service.subscribeFeed('https://example.org/')).rejects.toMatchObject({
      code: 'not-a-feed',
    });
    expect(service.snapshot().subscriptions).toEqual([]);
  });

  it('adds a website without fetching it', async () => {
    const { service, requests } = makeService(() => ok(''));
    const site = await service.subscribeSite('https://site.example/', 'Сайт');
    expect(site.kind).toBe('site');
    expect(requests).toHaveLength(0);
    expect(service.snapshot().unread).toBe(0);
  });

  it('inspects a feed address and a page address', async () => {
    const feedService = makeService(() =>
      ok(ATOM_FEED, { 'content-type': 'application/atom+xml' }),
    );
    const feed = await feedService.service.inspectSource('https://atom.example/feed');
    expect(feed).toMatchObject({ type: 'feed', feed: { format: 'atom' } });
    const pageService = makeService(() => ok(HTML_PAGE, { 'content-type': 'text/html' }));
    const page = await pageService.service.inspectSource('https://news.example/');
    expect(page).toMatchObject({ type: 'page', title: 'Журнал & сайт' });
    expect(page.type === 'page' ? page.feeds.map((entry) => entry.format) : []).toEqual([
      'rss',
      'atom',
    ]);
    const textService = makeService(() => ok('plain', { 'content-type': 'text/plain' }));
    await expect(textService.service.inspectSource('https://x.example/')).rejects.toMatchObject({
      code: 'not-a-feed',
    });
  });

  it('renames, switches images, and removes with its items', async () => {
    const { service, storage } = makeService(() => ok(RSS2_FEED));
    const subscription = await service.subscribeFeed('https://example.org/feed.xml');
    service.rename(subscription.id, '  Моя лента  ');
    service.rename(subscription.id, '   ');
    service.setImages(subscription.id, true);
    expect(service.snapshot().subscriptions[0]).toMatchObject({ title: 'Моя лента', images: true });
    await service.remove(subscription.id);
    expect(service.snapshot().subscriptions).toEqual([]);
    expect(service.snapshot().items).toEqual([]);
    expect(await storage.loadItems(subscription.id)).toEqual([]);
  });
});

describe('NewsService refresh and unread', () => {
  it('adds only new items on refresh and keeps read state', async () => {
    let body = RSS2_FEED;
    const { service } = makeService(() => ok(body));
    const subscription = await service.subscribeFeed('https://example.org/feed.xml');
    await service.markAllRead(subscription.id);
    expect(service.snapshot().unread).toBe(0);
    body = RSS2_FEED.replace(
      '</channel>',
      '<item><title>Третья</title><guid>news_3</guid><pubDate>Mon, 05 Oct 2026 11:00:00 GMT</pubDate></item></channel>',
    );
    const report = await service.refresh();
    expect(report).toMatchObject({ refreshed: 1, failed: 0, added: 1 });
    expect(service.snapshot().items).toHaveLength(3);
    expect(service.snapshot().unread).toBe(1);
  });

  it('sends validators and treats 304 as success without parsing', async () => {
    let call = 0;
    const { service, requests } = makeService((request) => {
      call += 1;
      if (call === 1)
        return ok(RSS2_FEED, { etag: '"v1"', 'last-modified': 'Mon, 05 Oct 2026 09:00:00 GMT' });
      expect(request.etag).toBe('"v1"');
      return { status: 304, notModified: true, text: '', finalUrl: request.url, headers: {} };
    });
    await service.subscribeFeed('https://example.org/feed.xml');
    const report = await service.refresh();
    expect(report).toMatchObject({ refreshed: 1, failed: 0, added: 0 });
    expect(requests[1]?.lastModified).toBe('Mon, 05 Oct 2026 09:00:00 GMT');
    expect(service.snapshot().subscriptions[0]?.error).toBeUndefined();
  });

  it('records a failure per source, keeps its cached items and clears it on success', async () => {
    let fail = false;
    const { service } = makeService(() => {
      if (fail) throw new FeedFetchError('cors', 'cors-message');
      return ok(RSS2_FEED);
    });
    await service.subscribeFeed('https://example.org/feed.xml');
    fail = true;
    const report = await service.refresh();
    expect(report).toMatchObject({ refreshed: 0, failed: 1 });
    const failed = service.snapshot().subscriptions[0];
    expect(failed?.error?.code).toBe('cors');
    expect(failed?.error?.message).toContain('браузера');
    expect(service.snapshot().items).toHaveLength(2);
    fail = false;
    await service.refresh();
    expect(service.snapshot().subscriptions[0]?.error).toBeUndefined();
  });

  it('refreshes only stale feeds when the tab opens', async () => {
    let now = NOW;
    const { service, requests } = makeService(() => ok(RSS2_FEED), { now: () => now });
    await service.subscribeFeed('https://example.org/feed.xml');
    expect(service.staleFeedIds(15 * 60_000)).toEqual([]);
    await service.refreshStale(15 * 60_000);
    expect(requests).toHaveLength(1);
    now += 20 * 60_000;
    await service.refreshStale(15 * 60_000);
    expect(requests).toHaveLength(2);
  });

  it('marks one item read and keeps the badge in step', async () => {
    const { service } = makeService(() => ok(RSS2_FEED));
    await service.subscribeFeed('https://example.org/feed.xml');
    const [first] = service.snapshot().items;
    expect(first).toBeDefined();
    const before = service.snapshot().unread;
    await service.markRead(first?.id ?? '');
    expect(service.snapshot().unread).toBe(first?.read ? before : before - 1);
    expect(service.itemById(first?.id ?? '')?.read).toBe(true);
    await service.markRead(first?.id ?? '', false);
    expect(service.snapshot().unread).toBe(before);
  });

  it('notifies subscribers and reports the refreshing set', async () => {
    const { service } = makeService(() => ok(RSS2_FEED));
    await service.subscribeFeed('https://example.org/feed.xml');
    const seen: number[] = [];
    const stop = service.subscribe(() => seen.push(service.snapshot().refreshing.size));
    await service.refresh();
    stop();
    expect(Math.max(...seen)).toBe(1);
    expect(seen[seen.length - 1]).toBe(0);
  });

  it('refuses subscriptions beyond the limit', async () => {
    const storage = createMemoryNewsStorage();
    const transport: FeedTransport = {
      kind: 'web',
      conditional: false,
      fetch: async () => ok(RSS2_FEED),
    };
    const service = new NewsService({
      storage,
      transport,
      now: () => NOW,
      online: () => true,
      limits: {
        maxItemsPerFeed: 200,
        maxAgeMs: 30 * 24 * 3600 * 1000,
        firstFetchUnreadWindowMs: 1000,
        maxSubscriptions: 1,
      },
    });
    await service.subscribeSite('https://one.example/', 'One');
    await expect(service.subscribeSite('https://two.example/', 'Two')).rejects.toThrow(/предел/u);
  });
});
