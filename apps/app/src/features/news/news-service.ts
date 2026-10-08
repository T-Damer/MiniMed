import { extractArticle } from '@/features/news/article-extract';
import { FeedParseError, type ParsedFeed, parseFeed } from '@/features/news/feed-parser';
import {
  createCanvasIconShrinker,
  fetchSourceIcon,
  ICON_RETRY_AFTER_MS,
  type IconShrinker,
  iconKeyFor,
  isStoredIconData,
} from '@/features/news/news-icons';
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
  hasItems,
  type NewsItem,
  type NewsLimits,
  PUBMED_ITEM_WINDOWS,
  type StoredArticle,
  type StoredIcon,
  type Subscription,
} from '@/features/news/news-types';
import {
  normalizePubmedQuery,
  pubmedSearchPageUrl,
  pubmedSubscriptionTitle,
} from '@/features/news/pubmed';
import {
  createPubmedClient,
  type PubmedClient,
  type PubmedSearchResult,
} from '@/features/news/pubmed-client';
import {
  classifyPayload,
  type DiscoveredFeed,
  discoverFeedLinks,
  hostLabel,
  pageTitleOf,
} from '@/features/news/source-url';
import { bundledAvatarFor } from '@/features/news/suggested-avatars';

export interface NewsSnapshot {
  readonly loaded: boolean;
  /** The cached items of every feed have been read from storage. */
  readonly itemsLoaded: boolean;
  readonly subscriptions: readonly Subscription[];
  /** Cached items of every subscription whose items are loaded, unordered. */
  readonly items: readonly NewsItem[];
  readonly refreshing: ReadonlySet<string>;
  readonly unread: number;
  /** Fetched avatars (data URLs) by site host; a source without one draws a monogram. */
  readonly icons: Readonly<Record<string, string>>;
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
  /** Start with the source's remote images switched on (suggested sources measured to carry them). */
  readonly images?: boolean;
  /** An avatar already fetched for the preview (a data URL), kept with the subscription. */
  readonly icon?: string;
}

/** A downloaded page: what the article view and the «as on the site» view both read. */
export interface FetchedPage {
  readonly html: string;
  readonly finalUrl: string;
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
  /** PubMed search; defaults to E-utilities through `transport`, rate-limited. */
  readonly pubmed?: PubmedClient;
  /**
   * Whether subscribing and refreshing also fetch the sites' avatars (one extra page request per
   * source, then the icon). The app turns it on; it is off where a test counts requests.
   */
  readonly fetchIcons?: boolean;
  /** Re-encodes a downloaded icon small; the browser's canvas by default. */
  readonly shrinkIcon?: IconShrinker | undefined;
}

const REFRESH_CONCURRENCY = 3;
/** Pages kept in memory so «as on the site» after the article costs no second request. */
const PAGE_CACHE_ENTRIES = 3;

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
  private readonly pubmed: PubmedClient;
  private readonly listeners = new Set<() => void>();
  private readonly itemsByFeed = new Map<string, readonly NewsItem[]>();
  private readonly itemLoads = new Map<string, Promise<void>>();
  private subscriptions: readonly Subscription[] = [];
  private refreshing: ReadonlySet<string> = new Set();
  private loaded = false;
  private itemsLoaded = false;
  private current: NewsSnapshot;
  private readonly fetchIcons: boolean;
  private readonly shrinkIcon: IconShrinker | undefined;
  private icons: Readonly<Record<string, StoredIcon>> = {};
  private iconView: Readonly<Record<string, string>> = {};
  private iconRun: Promise<void> | undefined;
  private readonly pages = new Map<string, FetchedPage>();

  constructor(deps: NewsServiceDeps) {
    this.storage = deps.storage;
    this.transport = deps.transport;
    this.now = deps.now ?? (() => Date.now());
    this.online =
      deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.limits = deps.limits ?? DEFAULT_NEWS_LIMITS;
    this.pubmed = deps.pubmed ?? createPubmedClient({ transport: this.transport, now: this.now });
    this.fetchIcons = deps.fetchIcons === true;
    this.shrinkIcon = 'shrinkIcon' in deps ? deps.shrinkIcon : createCanvasIconShrinker();
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
      icons: this.iconView,
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
    this.setIcons(this.storage.loadIcons(), false);
    this.loaded = true;
    this.publish(false);
    await Promise.all(
      this.subscriptions.filter((s) => hasItems(s.kind)).map((s) => this.ensureItems(s.id)),
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
      images: meta.images === true,
      addedAt: now,
      fetchedAt: now,
      ...(response?.headers['etag'] ? { etag: response.headers['etag'] } : {}),
      ...(response?.headers['last-modified']
        ? { lastModified: response.headers['last-modified'] }
        : {}),
      unread: 0,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    this.rememberIcon(subscription, meta.icon);
    const { items } = mergeFeedItems([], feed.items, {
      feedId: id,
      now,
      firstFetch: true,
      limits: this.limits,
    });
    await this.setItems(id, items);
    this.scheduleIcons();
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
      images: meta.images === true,
      addedAt: this.now(),
      unread: 0,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    this.rememberIcon(subscription, meta.icon);
    this.publish(true);
    this.scheduleIcons();
    return subscription;
  }

  /**
   * Looks PubMed up for the user (a user-initiated search, nothing is saved). The text is checked
   * before anything is sent; offline sends nothing.
   */
  async searchPubmed(rawQuery: string, signal?: AbortSignal): Promise<PubmedSearchResult> {
    const checked = normalizePubmedQuery(rawQuery);
    if (!checked.ok) throw new Error(checked.message);
    if (!this.online()) throw new FeedFetchError('offline', FAILURE_MESSAGES.offline);
    return this.pubmed.search(checked.query, signal);
  }

  /** Saves a PubMed search as a source; `result` (the search just shown) saves the second round of requests. */
  async subscribePubmed(rawQuery: string, result?: PubmedSearchResult): Promise<Subscription> {
    await this.load();
    const checked = normalizePubmedQuery(rawQuery);
    if (!checked.ok) throw new Error(checked.message);
    const url = pubmedSearchPageUrl(checked.query);
    const id = subscriptionIdFor(url);
    const existing = this.subscriptions.find((s) => s.id === id);
    if (existing) return existing;
    if (this.subscriptions.length >= this.limits.maxSubscriptions) {
      throw new Error('Достигнут предел числа источников. Удалите ненужные.');
    }
    const found = result?.query === checked.query ? result : await this.searchPubmed(checked.query);
    const now = this.now();
    const subscription: Subscription = {
      id,
      kind: 'pubmed',
      url,
      query: checked.query,
      title: pubmedSubscriptionTitle(checked.query),
      siteUrl: url,
      language: 'en',
      images: false,
      addedAt: now,
      fetchedAt: now,
      unread: 0,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    const { items } = mergeFeedItems([], found.items, {
      feedId: id,
      now,
      firstFetch: true,
      limits: this.pubmedLimits(),
    });
    await this.setItems(id, items);
    return this.subscriptions.find((s) => s.id === id) ?? subscription;
  }

  /** PubMed items are the newest hits of a search, often months old: they are kept for longer. */
  private pubmedLimits(): NewsLimits {
    return { ...this.limits, ...PUBMED_ITEM_WINDOWS };
  }

  private async refreshPubmed(subscription: Subscription): Promise<{ ok: boolean; added: number }> {
    const id = subscription.id;
    try {
      const found = await this.pubmed.search(subscription.query ?? '');
      const now = this.now();
      const current = this.itemsByFeed.get(id) ?? [];
      const merged = mergeFeedItems(current, found.items, {
        feedId: id,
        now,
        firstFetch: subscription.fetchedAt === undefined && current.length === 0,
        limits: this.pubmedLimits(),
      });
      this.updateSubscription(id, (s) => {
        const { error: _dropped, ...rest } = s;
        return { ...rest, fetchedAt: now };
      });
      await this.setItems(id, merged.items);
      await this.storage.pruneArticles(id, new Set(merged.items.map((item) => item.id)));
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

  private async refreshOne(id: string): Promise<{ ok: boolean; added: number }> {
    const subscription = this.subscriptions.find((s) => s.id === id);
    if (!subscription || !hasItems(subscription.kind)) return { ok: true, added: 0 };
    await this.ensureItems(id);
    if (subscription.kind === 'pubmed') return this.refreshPubmed(subscription);
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
      await this.storage.pruneArticles(id, new Set(merged.items.map((item) => item.id)));
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
      this.subscriptions.some((s) => s.id === id && hasItems(s.kind)),
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
    this.scheduleIcons();
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
        (s) => hasItems(s.kind) && (s.fetchedAt === undefined || now - s.fetchedAt > maxAgeMs),
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

  /** Marks many items read with one write per feed: the list batches what the reader scrolled past. */
  async markReadMany(itemIds: readonly string[]): Promise<void> {
    const wanted = new Set(itemIds);
    if (wanted.size === 0) return;
    for (const [feedId, items] of this.itemsByFeed) {
      const next = markItemsRead(items, wanted);
      if (next !== items) await this.setItems(feedId, next);
    }
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
    await this.storage.deleteArticles(id);
    this.dropUnusedIcons();
  }

  /** The article of an item as saved the last time it was downloaded, readable offline. */
  cachedArticle(itemId: string): Promise<StoredArticle | undefined> {
    return this.storage.loadArticle(itemId);
  }

  /**
   * Downloads a page (the viewer's «as on the site» view and the article extraction share it).
   * Throws {@link FeedFetchError}: `cors` is the browser build refusing, `offline` sends nothing.
   */
  async fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
    const known = this.pages.get(url);
    if (known) return known;
    if (!this.online()) throw new FeedFetchError('offline', FAILURE_MESSAGES.offline);
    const response = await this.transport.fetch({
      url,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      signal,
    });
    const page = { html: response.text, finalUrl: response.finalUrl };
    this.pages.set(url, page);
    while (this.pages.size > PAGE_CACHE_ENTRIES) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
    return page;
  }

  /**
   * Fetches the item's own page, extracts the article and saves it with the item for offline
   * reading. `undefined` when the page holds no article-sized text (the feed text stays the view).
   */
  async downloadArticle(item: NewsItem, signal?: AbortSignal): Promise<StoredArticle | undefined> {
    if (!item.url) return undefined;
    const page = await this.fetchPage(item.url, signal);
    const extracted = extractArticle(page.html, page.finalUrl);
    if (!extracted) return undefined;
    const article: StoredArticle = {
      itemId: item.id,
      feedId: item.feedId,
      url: item.url,
      fetchedAt: this.now(),
      ...(extracted.title ? { title: extracted.title } : {}),
      ...(extracted.byline ? { byline: extracted.byline } : {}),
      ...(extracted.imageUrl ? { imageUrl: extracted.imageUrl } : {}),
      content: extracted.content,
    };
    await this.storage.saveArticle(article);
    return article;
  }

  /** An avatar for the preview of an address (not stored until the user subscribes). */
  previewIcon(
    siteUrl: string,
    feedIconUrl?: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!this.online()) return Promise.resolve(undefined);
    return fetchSourceIcon({
      transport: this.transport,
      shrink: this.shrinkIcon,
      siteUrl,
      ...(feedIconUrl ? { feedIconUrl } : {}),
      signal,
    });
  }

  private siteOf(subscription: Subscription): string {
    if (subscription.siteUrl) return subscription.siteUrl;
    try {
      return `${new URL(subscription.url).origin}/`;
    } catch {
      return subscription.url;
    }
  }

  private setIcons(next: Readonly<Record<string, StoredIcon>>, persist: boolean): void {
    this.icons = next;
    const view: Record<string, string> = {};
    for (const [host, icon] of Object.entries(next)) if (icon.data) view[host] = icon.data;
    this.iconView = view;
    if (persist) this.storage.saveIcons(next);
  }

  private rememberIcon(subscription: Subscription, data: string | undefined): void {
    if (!data || !isStoredIconData(data)) return;
    this.setIcons(
      { ...this.icons, [iconKeyFor(this.siteOf(subscription))]: { data, checkedAt: this.now() } },
      true,
    );
  }

  /** Avatars of hosts no subscription points to any more are dropped with the last of its sources. */
  private dropUnusedIcons(): void {
    const used = new Set(this.subscriptions.map((s) => iconKeyFor(this.siteOf(s))));
    const kept = Object.fromEntries(Object.entries(this.icons).filter(([host]) => used.has(host)));
    if (Object.keys(kept).length === Object.keys(this.icons).length) return;
    this.setIcons(kept, true);
    this.publish(false);
  }

  /** The next source whose avatar is unknown and not tried within the last week. */
  private nextIconTarget(): Subscription | undefined {
    const now = this.now();
    return this.subscriptions.find((subscription) => {
      if (subscription.kind === 'pubmed') return false;
      const site = this.siteOf(subscription);
      if (bundledAvatarFor(site) !== undefined) return false;
      const known = this.icons[iconKeyFor(site)];
      return known === undefined || (!known.data && now - known.checkedAt > ICON_RETRY_AFTER_MS);
    });
  }

  private scheduleIcons(): void {
    if (!this.fetchIcons || this.iconRun) return;
    this.iconRun = this.runIcons().finally(() => {
      this.iconRun = undefined;
    });
  }

  private async runIcons(): Promise<void> {
    try {
      for (let target = this.nextIconTarget(); target; target = this.nextIconTarget()) {
        if (!this.online()) return;
        const site = this.siteOf(target);
        const data = await fetchSourceIcon({
          transport: this.transport,
          shrink: this.shrinkIcon,
          siteUrl: site,
        });
        // A failed attempt is recorded too, so the monogram is not retried on every refresh.
        this.setIcons(
          {
            ...this.icons,
            [iconKeyFor(site)]: { ...(data ? { data } : {}), checkedAt: this.now() },
          },
          true,
        );
        this.publish(false);
      }
    } catch (error) {
      console.warn('Не удалось получить значок источника.', error);
    }
  }

  /** Resolves when the avatar fetching started by a subscribe or a refresh has finished. */
  async settleIcons(): Promise<void> {
    await this.iconRun;
  }

  itemById(itemId: string): NewsItem | undefined {
    for (const items of this.itemsByFeed.values()) {
      const found = items.find((item) => item.id === itemId);
      if (found) return found;
    }
    return undefined;
  }
}
