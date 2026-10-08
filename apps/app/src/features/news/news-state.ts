import type { ParsedFeedItem } from '@/features/news/feed-parser';
import {
  DEFAULT_NEWS_LIMITS,
  hasItems,
  type NewsItem,
  type NewsLimits,
  type Subscription,
} from '@/features/news/news-types';

/** 53-bit string hash (cyrb53): stable ids for items and subscriptions without a crypto dependency. */
export function stableHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function subscriptionIdFor(url: string): string {
  return `s-${stableHash(url.replace(/\/+$/u, '').toLowerCase())}`;
}

export function itemIdFor(feedId: string, item: ParsedFeedItem): string {
  const key = item.guid ?? item.url ?? `${item.title}|${item.publishedAt ?? ''}`;
  return `i-${stableHash(`${feedId}\n${key}`)}`;
}

export interface MergeResult {
  readonly items: readonly NewsItem[];
  /** Items that were not stored before and are kept now. */
  readonly added: number;
}

export interface MergeOptions {
  readonly feedId: string;
  readonly now: number;
  /** No earlier fetch: only recent items are unread. */
  readonly firstFetch: boolean;
  readonly limits?: NewsLimits;
}

/**
 * Folds a fetch into the stored items of one feed. Read state and first-seen time of known items
 * survive; items older than the retention window are neither kept nor re-added (so they cannot
 * come back as «new»); the list is capped at the newest `maxItemsPerFeed`, newest first.
 */
export function mergeFeedItems(
  existing: readonly NewsItem[],
  incoming: readonly ParsedFeedItem[],
  options: MergeOptions,
): MergeResult {
  const limits = options.limits ?? DEFAULT_NEWS_LIMITS;
  const cutoff = options.now - limits.maxAgeMs;
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const parsed of incoming) {
    const id = itemIdFor(options.feedId, parsed);
    const known = byId.get(id);
    const publishedAt = Math.min(
      parsed.publishedAt ?? known?.publishedAt ?? options.now,
      options.now,
    );
    if (publishedAt < cutoff) continue;
    const read =
      known?.read ??
      (options.firstFetch && options.now - publishedAt > limits.firstFetchUnreadWindowMs);
    byId.set(id, {
      id,
      feedId: options.feedId,
      title: parsed.title,
      ...(parsed.url ? { url: parsed.url } : {}),
      snippet: parsed.snippet,
      content: parsed.content,
      ...(parsed.imageUrl ? { imageUrl: parsed.imageUrl } : {}),
      ...(parsed.author ? { author: parsed.author } : {}),
      publishedAt,
      firstSeenAt: known?.firstSeenAt ?? options.now,
      read,
    });
  }
  const kept = [...byId.values()]
    .filter((item) => item.publishedAt >= cutoff)
    .sort(
      (left, right) => right.publishedAt - left.publishedAt || right.firstSeenAt - left.firstSeenAt,
    )
    .slice(0, limits.maxItemsPerFeed);
  const existingIds = new Set(existing.map((item) => item.id));
  const added = kept.filter((item) => !existingIds.has(item.id)).length;
  return { items: kept, added };
}

export function countUnread(items: readonly NewsItem[]): number {
  let unread = 0;
  for (const item of items) if (!item.read) unread += 1;
  return unread;
}

export function markItemsRead(
  items: readonly NewsItem[],
  ids: ReadonlySet<string> | 'all',
  read = true,
): readonly NewsItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.read === read || (ids !== 'all' && !ids.has(item.id))) return item;
    changed = true;
    return { ...item, read };
  });
  return changed ? next : items;
}

export function totalUnread(subscriptions: readonly Subscription[]): number {
  return subscriptions.reduce(
    (sum, subscription) => sum + (hasItems(subscription.kind) ? subscription.unread : 0),
    0,
  );
}

/** Items of any order, newest first (the feed is one flat list, not grouped by day). */
export function sortNewestFirst(items: readonly NewsItem[]): readonly NewsItem[] {
  return [...items].sort(
    (left, right) => right.publishedAt - left.publishedAt || right.firstSeenAt - left.firstSeenAt,
  );
}

function dayKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «обновлено 5 мин назад» style text for the freshness line; the fetch time is always shown. */
export function fetchedAtLabel(fetchedAt: number | undefined, now: number): string {
  if (fetchedAt === undefined) return 'ещё не загружалось';
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const date = new Date(fetchedAt);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (dayKey(fetchedAt) === dayKey(now)) return `сегодня в ${time}`;
  if (dayKey(fetchedAt) === dayKey(now - 24 * 60 * 60 * 1000)) return `вчера в ${time}`;
  return `${DAY_FORMAT.format(fetchedAt)} в ${time}`;
}

/** Russian counter form: 1 источник, 2 источника, 5 источников. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
