import type { SafeNode } from '@/features/news/feed-content';

/**
 * A feed is read as items; a site is only opened in the viewer (no items, no unread count); a
 * `pubmed` subscription is a saved PubMed search whose newest results become items (ADR-0024).
 */
export type SubscriptionKind = 'feed' | 'site' | 'pubmed';

/** Whether the subscription produces cached items (and therefore unread counts and refreshes). */
export function hasItems(kind: SubscriptionKind): boolean {
  return kind === 'feed' || kind === 'pubmed';
}

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
  /** Feed address; for `pubmed` the PubMed web page of the same search (only ever opened by the user). */
  readonly url: string;
  readonly title: string;
  /** The search text of a `pubmed` subscription, sent to NCBI on every refresh. */
  readonly query?: string;
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

/** PubMed search results are the newest hits, often months old: kept and flagged unread over longer windows. */
export const PUBMED_ITEM_WINDOWS: Pick<NewsLimits, 'maxAgeMs' | 'firstFetchUnreadWindowMs'> = {
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
  firstFetchUnreadWindowMs: 14 * 24 * 60 * 60 * 1000,
};
