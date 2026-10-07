import type { AppGlyphName } from '@/components/AppGlyph';
import suggestedFeedData from '@/features/news/suggested-feeds.json';

export type SuggestedFeedGroup = 'ru' | 'international';

/** Glyphs a source may use for its topic; the JSON is checked against this list. */
export const SUGGESTED_GLYPHS: readonly AppGlyphName[] = [
  'globe',
  'pill',
  'newspaper',
  'heartbeat',
  'book-open',
  'books',
  'microscope',
  'prescription',
  'flask',
  'scales',
];

/**
 * The bundled stand-in for a logo: a coloured monogram tile. Nothing is downloaded for it (ADR-0024:
 * no request before the user subscribes) and no trademark artwork is copied.
 */
export interface SuggestedVisual {
  /** One to four characters shown on the tile. */
  readonly mark: string;
  /** HSL hue, 0-360; the tile's lightness and the theme stay with the stylesheet. */
  readonly hue: number;
  /** Glyph of the topic, shown beside the topic label. */
  readonly glyph: AppGlyphName;
}

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
  /** What the source covers, in a few words. */
  readonly topic: string;
  readonly visual: SuggestedVisual;
  /** Measured: the feed's items carry pictures, so the source is subscribed with «Изображения» on. */
  readonly carriesImages: boolean;
}

export const SUGGESTED_FEED_GROUPS: readonly {
  readonly id: SuggestedFeedGroup;
  readonly title: string;
}[] = [
  { id: 'ru', title: 'Россия' },
  { id: 'international', title: 'Международные' },
];

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { ru: 'RU', en: 'EN' };

function isVisual(value: unknown): value is SuggestedVisual {
  if (typeof value !== 'object' || value === null) return false;
  const visual = value as Record<string, unknown>;
  return (
    typeof visual['mark'] === 'string' &&
    visual['mark'].length >= 1 &&
    visual['mark'].length <= 4 &&
    typeof visual['hue'] === 'number' &&
    visual['hue'] >= 0 &&
    visual['hue'] <= 360 &&
    typeof visual['glyph'] === 'string' &&
    (SUGGESTED_GLYPHS as readonly string[]).includes(visual['glyph'])
  );
}

export function isSuggestedFeed(value: unknown): value is SuggestedFeed {
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
    typeof feed['webReadable'] === 'boolean' &&
    typeof feed['topic'] === 'string' &&
    feed['topic'] !== '' &&
    isVisual(feed['visual']) &&
    typeof feed['carriesImages'] === 'boolean'
  );
}

/** The curated list is data: edit `suggested-feeds.json`, not the interface. */
export const SUGGESTED_FEEDS: readonly SuggestedFeed[] = (
  suggestedFeedData.feeds as readonly unknown[]
).filter(isSuggestedFeed);

export const SUGGESTED_FEEDS_VERIFIED_AT: string = suggestedFeedData.verifiedAt;

export function suggestedFeedById(id: string | undefined): SuggestedFeed | undefined {
  return id === undefined ? undefined : SUGGESTED_FEEDS.find((feed) => feed.id === id);
}

export function suggestedFeedByUrl(url: string): SuggestedFeed | undefined {
  return SUGGESTED_FEEDS.find((feed) => feed.url === url);
}

/** Suggested sources the user has not subscribed to yet, in the data's order. */
export function unsubscribedSuggestions(
  subscribedUrls: ReadonlySet<string>,
  feeds: readonly SuggestedFeed[] = SUGGESTED_FEEDS,
): readonly SuggestedFeed[] {
  return feeds.filter((feed) => !subscribedUrls.has(feed.url));
}
