import type { SafeNode } from '@/features/news/feed-content';

/** A feed is read as items; a site is only opened in the viewer (no items, no unread count). */
export type SubscriptionKind = 'feed' | 'site';

export type FetchFailureCode =
  | 'offline'
  | 'cors'
  | 'network'
  | 'timeout'
  | 'http'
  | 'too-large'
  | 'not-a-feed'
  | 'malformed'
  | 'empty';

export interface SubscriptionError {
  readonly code: FetchFailureCode;
  readonly message: string;
  /** Epoch milliseconds of the failed attempt. */
  readonly at: number;
}

export interface Subscription {
  readonly id: string;
  readonly kind: SubscriptionKind;
  readonly url: string;
  readonly title: string;
  readonly siteUrl?: string;
  /** Language label of a suggested source (`ru`, `en`), for the badge. */
  readonly language?: string;
  /** Id in the suggested-sources data when the user picked it from there. */
  readonly suggestedId?: string;
  /** Remote images of this source are fetched only when switched on. */
  readonly images: boolean;
  readonly addedAt: number;
  /** Epoch milliseconds of the last successful fetch. */
  readonly fetchedAt?: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly error?: SubscriptionError;
  readonly unread: number;
}

export interface NewsItem {
  readonly id: string;
  readonly feedId: string;
  readonly title: string;
  readonly url?: string;
  readonly snippet: string;
  /** Sanitized text of the item as the feed published it; readable offline. */
  readonly content: readonly SafeNode[];
  readonly imageUrl?: string;
  readonly author?: string;
  /** Epoch milliseconds; the first time the item was seen when the feed gives no date. */
  readonly publishedAt: number;
  readonly firstSeenAt: number;
  readonly read: boolean;
}

export interface NewsLimits {
  /** Items kept per feed. */
  readonly maxItemsPerFeed: number;
  /** Items older than this are not kept (and not re-added from the feed). */
  readonly maxAgeMs: number;
  /** On the first fetch only items from this recent window count as unread. */
  readonly firstFetchUnreadWindowMs: number;
  readonly maxSubscriptions: number;
}

export const DEFAULT_NEWS_LIMITS: NewsLimits = {
  maxItemsPerFeed: 200,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  firstFetchUnreadWindowMs: 3 * 24 * 60 * 60 * 1000,
  maxSubscriptions: 40,
};
