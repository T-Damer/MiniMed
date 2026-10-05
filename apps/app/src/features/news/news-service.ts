import { FeedParseError, type ParsedFeed, parseFeed } from '@/features/news/feed-parser';
import {
  countUnread,
  markItemsRead,
  mergeFeedItems,
  subscriptionIdFor,
  totalUnread,
} from '@/features/news/news-state';
import { NEWS_CHANGED_EVENT, type NewsStorage } from '@/features/news/news-storage';
import {
  FAILURE_MESSAGES,
  FeedFetchError,
  type FeedTransport,
  failureMessage,
} from '@/features/news/news-transport';
import {
  DEFAULT_NEWS_LIMITS,
  type FetchFailureCode,
  type NewsItem,
  type NewsLimits,
  type Subscription,
} from '@/features/news/news-types';
import {
  classifyPayload,
  type DiscoveredFeed,
  discoverFeedLinks,
  hostLabel,
  pageTitleOf,
} from '@/features/news/source-url';

export interface NewsSnapshot {
  readonly loaded: boolean;
  /** The cached items of every feed have been read from storage. */
  readonly itemsLoaded: boolean;
  readonly subscriptions: readonly Subscription[];
  /** Cached items of every subscription whose items are loaded, unordered. */
  readonly items: readonly NewsItem[];
  readonly refreshing: ReadonlySet<string>;
  readonly unread: number;
}

export type SourceInspection =
  | {
      readonly type: 'feed';
      readonly url: string;
      readonly feed: ParsedFeed;
    }
  | {
      readonly type: 'page';
      readonly url: string;
      readonly title: string;
      /** Feeds the page declares; empty when it declares none. */
      readonly feeds: readonly DiscoveredFeed[];
    };

export interface SubscribeMeta {
  readonly title?: string;
  readonly language?: string;
  readonly suggestedId?: string;
}

export interface RefreshReport {
  readonly offline: boolean;
  readonly refreshed: number;
  readonly failed: number;
  readonly added: number;
}

export interface NewsServiceDeps {
  readonly storage: NewsStorage;
  readonly transport: FeedTransport;
  readonly now?: () => number;
  readonly online?: () => boolean;
  readonly limits?: NewsLimits;
}

const REFRESH_CONCURRENCY = 3;

function failureOf(error: unknown): { code: FetchFailureCode; message: string } {
  if (error instanceof FeedFetchError) {
    return { code: error.code, message: failureMessage(error.code, error.status) };
  }
  if (error instanceof FeedParseError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'network', message: FAILURE_MESSAGES.network };
}

/**
 * Subscriptions, cached items and refresh (ADR-0024). Plain TypeScript: the UI subscribes to
 * snapshots. It makes no request until a subscription exists or the user asks to inspect an
 * address, and never in the background.
 */
export class NewsService {
  private readonly storage: NewsStorage;
  private readonly transport: FeedTransport;
  private readonly now: () => number;
  private readonly online: () => boolean;
  private readonly limits: NewsLimits;
  private readonly listeners = new Set<() => void>();
  private readonly itemsByFeed = new Map<string, readonly NewsItem[]>();
  private readonly itemLoads = new Map<string, Promise<void>>();
  private subscriptions: readonly Subscription[] = [];
  private refreshing: ReadonlySet<string> = new Set();
  private loaded = false;
  private itemsLoaded = false;
  private current: NewsSnapshot;

  constructor(deps: NewsServiceDeps) {
    this.storage = deps.storage;
    this.transport = deps.transport;
    this.now = deps.now ?? (() => Date.now());
    this.online =
      deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.limits = deps.limits ?? DEFAULT_NEWS_LIMITS;
    this.current = this.buildSnapshot();
  }

  get transportKind(): FeedTransport['kind'] {
    return this.transport.kind;
  }

  snapshot(): NewsSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private buildSnapshot(): NewsSnapshot {
    return {
      loaded: this.loaded,
      itemsLoaded: this.itemsLoaded,
      subscriptions: this.subscriptions,
      items: [...this.itemsByFeed.values()].flat(),
      refreshing: this.refreshing,
      unread: totalUnread(this.subscriptions),
    };
  }

  private publish(persistSubscriptions: boolean): void {
    if (persistSubscriptions) {
      this.storage.saveSubscriptions(this.subscriptions);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(NEWS_CHANGED_EVENT));
    }
    this.current = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  /** Reads subscriptions, then the cached items of each (offline-first: no network here). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.subscriptions = this.storage.loadSubscriptions();
    this.loaded = true;
    this.publish(false);
    await Promise.all(
      this.subscriptions.filter((s) => s.kind === 'feed').map((s) => this.ensureItems(s.id)),
    );
    this.itemsLoaded = true;
    this.publish(false);
  }

  private ensureItems(feedId: string): Promise<void> {
    if (this.itemsByFeed.has(feedId)) return Promise.resolve();
    let pending = this.itemLoads.get(feedId);
    if (!pending) {
      pending = this.storage.loadItems(feedId).then((items) => {
        if (!this.itemsByFeed.has(feedId)) this.itemsByFeed.set(feedId, items);
        this.itemLoads.delete(feedId);
        this.publish(false);
      });
      this.itemLoads.set(feedId, pending);
    }
    return pending;
  }

  private updateSubscription(id: string, change: (current: Subscription) => Subscription): void {
    this.subscriptions = this.subscriptions.map((s) => (s.id === id ? change(s) : s));
  }

  private async setItems(feedId: string, items: readonly NewsItem[]): Promise<void> {
    this.itemsByFeed.set(feedId, items);
    this.updateSubscription(feedId, (s) => ({ ...s, unread: countUnread(items) }));
    this.publish(true);
    await this.storage.saveItems(feedId, items);
  }

  /** Looks at an address the user pasted: a feed (parsed), or a page (with the feeds it declares). */
  async inspectSource(url: string, signal?: AbortSignal): Promise<SourceInspection> {
    if (!this.online()) throw new FeedFetchError('offline', FAILURE_MESSAGES.offline);
    const response = await this.transport.fetch({ url, signal });
    const kind = classifyPayload(response.text, response.headers['content-type']);
    if (kind === 'feed') {
      return {
        type: 'feed',
        url: response.finalUrl,
        feed: parseFeed(response.text, { baseUrl: response.finalUrl }),
      };
    }
    if (kind === 'html') {
      return {
        type: 'page',
        url: response.finalUrl,
        title: pageTitleOf(response.text),
        feeds: discoverFeedLinks(response.text, response.finalUrl),
      };
    }
    throw new FeedParseError('not-a-feed', FAILURE_MESSAGES['not-a-feed']);
  }

  /** Subscribes to a feed; `parsed` skips the second fetch when the address was just inspected. */
  async subscribeFeed(
    url: string,
    meta: SubscribeMeta = {},
    parsed?: ParsedFeed,
  ): Promise<Subscription> {
    await this.load();
    const id = subscriptionIdFor(url);
    const existing = this.subscriptions.find((s) => s.id === id);
    if (existing) return existing;
    if (this.subscriptions.length >= this.limits.maxSubscriptions) {
      throw new Error('Достигнут предел числа источников. Удалите ненужные.');
    }
    let feed = parsed;
    let response: Awaited<ReturnType<FeedTransport['fetch']>> | undefined;
    if (!feed) {
      if (!this.online()) throw new FeedFetchError('offline', FAILURE_MESSAGES.offline);
      response = await this.transport.fetch({ url });
      feed = parseFeed(response.text, { baseUrl: response.finalUrl });
    }
    const now = this.now();
    const title = meta.title?.trim() || feed.title || hostLabel(url);
    const language = meta.language ?? feed.language?.slice(0, 2).toLowerCase();
    const subscription: Subscription = {
      id,
      kind: 'feed',
      url,
      title,
      ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
      ...(language ? { language } : {}),
      ...(meta.suggestedId ? { suggestedId: meta.suggestedId } : {}),
      images: false,
      addedAt: now,
      fetchedAt: now,
      ...(response?.headers['etag'] ? { etag: response.headers['etag'] } : {}),
      ...(response?.headers['last-modified']
        ? { lastModified: response.headers['last-modified'] }
        : {}),
      unread: 0,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    const { items } = mergeFeedItems([], feed.items, {
      feedId: id,
      now,
      firstFetch: true,
      limits: this.limits,
    });
    await this.setItems(id, items);
    return this.subscriptions.find((s) => s.id === id) ?? subscription;
  }

  /** A website: opened in the viewer, never fetched or parsed here. */
  async subscribeSite(url: string, title: string, meta: SubscribeMeta = {}): Promise<Subscription> {
    await this.load();
    const id = subscriptionIdFor(url);
    const existing = this.subscriptions.find((s) => s.id === id);
    if (existing) return existing;
    if (this.subscriptions.length >= this.limits.maxSubscriptions) {
      throw new Error('Достигнут предел числа источников. Удалите ненужные.');
    }
    const subscription: Subscription = {
      id,
      kind: 'site',
      url,
      title: title.trim() || hostLabel(url),
      siteUrl: url,
      ...(meta.language ? { language: meta.language } : {}),
      ...(meta.suggestedId ? { suggestedId: meta.suggestedId } : {}),
      images: false,
      addedAt: this.now(),
      unread: 0,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    this.publish(true);
    return subscription;
  }

  private async refreshOne(id: string): Promise<{ ok: boolean; added: number }> {
    const subscription = this.subscriptions.find((s) => s.id === id);
    if (subscription?.kind !== 'feed') return { ok: true, added: 0 };
    await this.ensureItems(id);
    try {
      const response = await this.transport.fetch({
        url: subscription.url,
        etag: subscription.etag,
        lastModified: subscription.lastModified,
      });
      const now = this.now();
      if (response.notModified) {
        this.updateSubscription(id, (s) => {
          const { error: _dropped, ...rest } = s;
          return { ...rest, fetchedAt: now };
        });
        this.publish(true);
        return { ok: true, added: 0 };
      }
      const feed = parseFeed(response.text, { baseUrl: response.finalUrl });
      const current = this.itemsByFeed.get(id) ?? [];
      const merged = mergeFeedItems(current, feed.items, {
        feedId: id,
        now,
        firstFetch: subscription.fetchedAt === undefined && current.length === 0,
        limits: this.limits,
      });
      this.updateSubscription(id, (s) => {
        const { error: _dropped, etag: _etag, lastModified: _modified, ...rest } = s;
        return {
          ...rest,
          fetchedAt: now,
          ...(response.headers['etag'] ? { etag: response.headers['etag'] } : {}),
          ...(response.headers['last-modified']
            ? { lastModified: response.headers['last-modified'] }
            : {}),
        };
      });
      await this.setItems(id, merged.items);
      return { ok: true, added: merged.added };
    } catch (error) {
      const failure = failureOf(error);
      this.updateSubscription(id, (s) => ({
        ...s,
        error: { code: failure.code, message: failure.message, at: this.now() },
      }));
      this.publish(true);
      return { ok: false, added: 0 };
    }
  }

  /** Refreshes the given feeds (all when omitted); no request at all while offline. */
  async refresh(ids?: readonly string[]): Promise<RefreshReport> {
    await this.load();
    const targets = (ids ?? this.subscriptions.map((s) => s.id)).filter((id) =>
      this.subscriptions.some((s) => s.id === id && s.kind === 'feed'),
    );
    if (targets.length === 0) return { offline: false, refreshed: 0, failed: 0, added: 0 };
    if (!this.online()) return { offline: true, refreshed: 0, failed: 0, added: 0 };
    this.refreshing = new Set([...this.refreshing, ...targets]);
    this.publish(false);
    const queue = [...targets];
    let refreshed = 0;
    let failed = 0;
    let added = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        const result = await this.refreshOne(id);
        if (result.ok) refreshed += 1;
        else failed += 1;
        added += result.added;
        const next = new Set(this.refreshing);
        next.delete(id);
        this.refreshing = next;
        this.publish(false);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(REFRESH_CONCURRENCY, targets.length) }, () => worker()),
    );
    return { offline: false, refreshed, failed, added };
  }

  /** Opening the tab: refreshes only feeds that have gone stale, so a quick return costs no requests. */
  async refreshStale(maxAgeMs: number): Promise<RefreshReport> {
    await this.load();
    return this.refresh(this.staleFeedIds(maxAgeMs));
  }

  /** The feeds not fetched for `maxAgeMs` (or never): what opening the tab refreshes. */
  staleFeedIds(maxAgeMs: number): readonly string[] {
    const now = this.now();
    return this.subscriptions
      .filter(
        (s) => s.kind === 'feed' && (s.fetchedAt === undefined || now - s.fetchedAt > maxAgeMs),
      )
      .map((s) => s.id);
  }

  async markRead(itemId: string, read = true): Promise<void> {
    for (const [feedId, items] of this.itemsByFeed) {
      if (!items.some((item) => item.id === itemId)) continue;
      const next = markItemsRead(items, new Set([itemId]), read);
      if (next !== items) await this.setItems(feedId, next);
      return;
    }
  }

  async markAllRead(feedId?: string): Promise<void> {
    for (const [id, items] of this.itemsByFeed) {
      if (feedId !== undefined && id !== feedId) continue;
      const next = markItemsRead(items, 'all');
      if (next !== items) await this.setItems(id, next);
    }
  }

  rename(id: string, title: string): void {
    const trimmed = title.trim().slice(0, 120);
    if (trimmed === '') return;
    this.updateSubscription(id, (s) => ({ ...s, title: trimmed }));
    this.publish(true);
  }

  setImages(id: string, images: boolean): void {
    this.updateSubscription(id, (s) => ({ ...s, images }));
    this.publish(true);
  }

  async remove(id: string): Promise<void> {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
    this.itemsByFeed.delete(id);
    this.publish(true);
    await this.storage.deleteItems(id);
  }

  itemById(itemId: string): NewsItem | undefined {
    for (const items of this.itemsByFeed.values()) {
      const found = items.find((item) => item.id === itemId);
      if (found) return found;
    }
    return undefined;
  }
}
