import suggestedFeedData from '@/features/news/suggested-feeds.json';

export type SuggestedFeedGroup = 'ru' | 'international';

export interface SuggestedFeed {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly siteUrl: string;
  /** Language of the source's items. */
  readonly language: 'ru' | 'en';
  readonly group: SuggestedFeedGroup;
  /** Measured: the host lets the browser build read it (CORS). Android reads every source. */
  readonly webReadable: boolean;
}

export const SUGGESTED_FEED_GROUPS: readonly {
  readonly id: SuggestedFeedGroup;
  readonly title: string;
}[] = [
  { id: 'ru', title: 'Россия' },
  { id: 'international', title: 'Международные' },
];

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { ru: 'RU', en: 'EN' };

function isSuggestedFeed(value: unknown): value is SuggestedFeed {
  if (typeof value !== 'object' || value === null) return false;
  const feed = value as Record<string, unknown>;
  return (
    typeof feed['id'] === 'string' &&
    typeof feed['title'] === 'string' &&
    typeof feed['description'] === 'string' &&
    typeof feed['url'] === 'string' &&
    /^https:\/\//u.test(feed['url']) &&
    typeof feed['siteUrl'] === 'string' &&
    (feed['language'] === 'ru' || feed['language'] === 'en') &&
    (feed['group'] === 'ru' || feed['group'] === 'international') &&
    typeof feed['webReadable'] === 'boolean'
  );
}

/** The curated list is data: edit `suggested-feeds.json`, not the interface. */
export const SUGGESTED_FEEDS: readonly SuggestedFeed[] = (
  suggestedFeedData.feeds as readonly unknown[]
).filter(isSuggestedFeed);

export const SUGGESTED_FEEDS_VERIFIED_AT: string = suggestedFeedData.verifiedAt;

export function suggestedFeedByUrl(url: string): SuggestedFeed | undefined {
  return SUGGESTED_FEEDS.find((feed) => feed.url === url);
}
