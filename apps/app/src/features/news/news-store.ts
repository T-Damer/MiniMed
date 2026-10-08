import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

import { NewsService, type NewsSnapshot } from '@/features/news/news-service';
import {
  createBrowserNewsStorage,
  NEWS_CHANGED_EVENT,
  NEWS_SUBSCRIPTIONS_KEY,
  readStoredUnreadCount,
} from '@/features/news/news-storage';
import { createDefaultFeedTransport, type FeedTransport } from '@/features/news/news-transport';

let instance: NewsService | undefined;
let transport: FeedTransport | undefined;

function feedTransport(): FeedTransport {
  transport ??= createDefaultFeedTransport();
  return transport;
}

/** The one service of this page; created on first use so an app that never opens «Лента» pays nothing. */
export function getNewsService(): NewsService {
  instance ??= new NewsService({
    storage: createBrowserNewsStorage(),
    transport: feedTransport(),
    fetchIcons: true,
  });
  return instance;
}

export function useNewsSnapshot(): Accessor<NewsSnapshot> {
  const service = getNewsService();
  const [snapshot, setSnapshot] = createSignal(service.snapshot());
  onMount(() => {
    const stop = service.subscribe(() => setSnapshot(service.snapshot()));
    onCleanup(stop);
    setSnapshot(service.snapshot());
    void service.load();
  });
  return snapshot;
}

/** The tab badge: reads localStorage only, so it costs nothing before the feed is ever opened. */
export function useNewsUnreadCount(): Accessor<number> {
  const [count, setCount] = createSignal(readStoredUnreadCount());
  const refresh = (event?: Event): void => {
    if (event instanceof StorageEvent && event.key !== NEWS_SUBSCRIPTIONS_KEY) return;
    setCount(readStoredUnreadCount());
  };
  onMount(() => {
    window.addEventListener(NEWS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    onCleanup(() => {
      window.removeEventListener(NEWS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    });
  });
  return count;
}
