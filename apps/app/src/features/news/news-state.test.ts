import { describe, expect, it } from 'vitest';

import type { ParsedFeedItem } from '@/features/news/feed-parser';
import {
  countUnread,
  dayLabel,
  fetchedAtLabel,
  groupItemsByDay,
  itemIdFor,
  markItemsRead,
  mergeFeedItems,
  pluralRu,
  stableHash,
  subscriptionIdFor,
  totalUnread,
} from '@/features/news/news-state';
import { DEFAULT_NEWS_LIMITS, type NewsItem, type Subscription } from '@/features/news/news-types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T12:00:00');

function parsed(guid: string, ageMs: number, extra: Partial<ParsedFeedItem> = {}): ParsedFeedItem {
  return {
    guid,
    title: `Title ${guid}`,
    snippet: `Snippet ${guid}`,
    content: [],
    publishedAt: NOW - ageMs,
    ...extra,
  };
}

function stored(id: string, publishedAt: number, read = false): NewsItem {
  return {
    id,
    feedId: 'f1',
    title: id,
    snippet: '',
    content: [],
    publishedAt,
    firstSeenAt: publishedAt,
    read,
  };
}

describe('ids', () => {
  it('hashes stably and differently per input', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(subscriptionIdFor('https://a.example/feed/')).toBe(
      subscriptionIdFor('https://A.example/feed'),
    );
    expect(itemIdFor('f1', parsed('g', 0))).not.toBe(itemIdFor('f2', parsed('g', 0)));
  });
});

describe('mergeFeedItems', () => {
  it('marks only recent items unread on the first fetch', () => {
    const { items, added } = mergeFeedItems([], [parsed('new', DAY), parsed('old', 10 * DAY)], {
      feedId: 'f1',
      now: NOW,
      firstFetch: true,
    });
    expect(added).toBe(2);
    expect(items.map((item) => [item.title, item.read])).toEqual([
      ['Title new', false],
      ['Title old', true],
    ]);
  });

  it('marks every new item unread on later fetches and keeps read state of known items', () => {
    const first = mergeFeedItems([], [parsed('a', DAY)], {
      feedId: 'f1',
      now: NOW,
      firstFetch: false,
    });
    const read = markItemsRead(first.items, 'all');
    const second = mergeFeedItems(read, [parsed('a', DAY, { title: 'Edited' }), parsed('b', 0)], {
      feedId: 'f1',
      now: NOW + 1000,
      firstFetch: false,
    });
    expect(second.added).toBe(1);
    const byTitle = new Map(second.items.map((item) => [item.title, item]));
    expect(byTitle.get('Edited')?.read).toBe(true);
    expect(byTitle.get('Title b')?.read).toBe(false);
    expect(byTitle.get('Edited')?.firstSeenAt).toBe(NOW);
  });

  it('does not keep or re-add items older than the retention window', () => {
    const limits = DEFAULT_NEWS_LIMITS;
    const result = mergeFeedItems(
      [stored('ancient', NOW - 40 * DAY, true)],
      [parsed('stale', limits.maxAgeMs + DAY), parsed('fresh', DAY)],
      { feedId: 'f1', now: NOW, firstFetch: false },
    );
    expect(result.items.map((item) => item.title)).toEqual(['Title fresh']);
    expect(result.added).toBe(1);
  });

  it('caps the list at the newest items and orders newest first', () => {
    const incoming = Array.from({ length: 30 }, (_, index) => parsed(`g${index}`, index * 1000));
    const result = mergeFeedItems([], incoming, {
      feedId: 'f1',
      now: NOW,
      firstFetch: false,
      limits: { ...DEFAULT_NEWS_LIMITS, maxItemsPerFeed: 10 },
    });
    expect(result.items).toHaveLength(10);
    expect(result.added).toBe(10);
    expect(result.items[0]?.title).toBe('Title g0');
    expect(result.items[9]?.title).toBe('Title g9');
  });

  it('uses the fetch time for an item without a date and clamps future dates', () => {
    const undated: ParsedFeedItem = { guid: 'u', title: 'U', snippet: '', content: [] };
    const future = parsed('f', -5 * DAY);
    const result = mergeFeedItems([], [undated, future], {
      feedId: 'f1',
      now: NOW,
      firstFetch: false,
    });
    expect(result.items.every((item) => item.publishedAt === NOW)).toBe(true);
  });
});

describe('unread bookkeeping', () => {
  it('counts, marks one, marks all and keeps identity when nothing changes', () => {
    const items = [stored('a', NOW), stored('b', NOW - 1000), stored('c', NOW - 2000, true)];
    expect(countUnread(items)).toBe(2);
    const one = markItemsRead(items, new Set(['a']));
    expect(countUnread(one)).toBe(1);
    expect(markItemsRead(one, new Set(['a']))).toBe(one);
    expect(countUnread(markItemsRead(items, 'all'))).toBe(0);
    expect(countUnread(markItemsRead(markItemsRead(items, 'all'), new Set(['a']), false))).toBe(1);
  });

  it('sums unread of feeds only', () => {
    const base = { url: 'https://a.example', title: 't', images: false, addedAt: 0 };
    const subscriptions: Subscription[] = [
      { ...base, id: '1', kind: 'feed', unread: 3 },
      { ...base, id: '2', kind: 'site', unread: 9 },
      { ...base, id: '3', kind: 'feed', unread: 2 },
    ];
    expect(totalUnread(subscriptions)).toBe(5);
  });
});

describe('grouping and labels', () => {
  it('groups by local day, newest first, with Сегодня and Вчера', () => {
    const items = [
      stored('old', NOW - 5 * DAY),
      stored('today-early', NOW - 3 * 60 * 60 * 1000),
      stored('yesterday', NOW - DAY),
      stored('today-late', NOW - 60 * 1000),
    ];
    const groups = groupItemsByDay(items, NOW);
    expect(groups.map((group) => group.label)).toEqual([
      'Сегодня',
      'Вчера',
      dayLabel(NOW - 5 * DAY, NOW),
    ]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['today-late', 'today-early']);
    expect(groups[2]?.label).toMatch(/30 сентября/u);
  });

  it('describes when a feed was fetched', () => {
    expect(fetchedAtLabel(undefined, NOW)).toBe('ещё не загружалось');
    expect(fetchedAtLabel(NOW - 20_000, NOW)).toBe('только что');
    expect(fetchedAtLabel(NOW - 5 * 60_000, NOW)).toBe('5 мин назад');
    expect(fetchedAtLabel(NOW - 3 * 60 * 60_000, NOW)).toMatch(/^сегодня в /u);
    expect(fetchedAtLabel(NOW - DAY, NOW)).toMatch(/^вчера в /u);
  });

  it('chooses the Russian counter form', () => {
    const form = (count: number) => pluralRu(count, 'источник', 'источника', 'источников');
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(form)).toEqual([
      'источник',
      'источника',
      'источников',
      'источников',
      'источников',
      'источник',
      'источника',
      'источников',
      'источников',
    ]);
  });
});
