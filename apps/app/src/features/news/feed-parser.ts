import {
  firstImageOf,
  hasSafeContent,
  plainTextFromHtml,
  type SafeNode,
  safeImageUrl,
  safeLinkUrl,
  sanitizeFeedHtml,
  snippetFrom,
} from '@/features/news/feed-content';
import {
  findChild,
  findChildren,
  findDescendant,
  type MarkupElement,
  parseMarkup,
  textContent,
} from '@/features/news/markup';

/** What a feed can be asked for; every value is a hard ceiling, not a target (ADR-0024). */
export interface FeedLimits {
  /** Characters of feed text read at all. */
  readonly maxChars: number;
  /** Items taken from one fetch (newest first as the feed lists them). */
  readonly maxItems: number;
  readonly maxTitleChars: number;
  readonly maxSnippetChars: number;
  /** Raw markup of one item's content that is even looked at. */
  readonly maxItemHtmlChars: number;
}

export const DEFAULT_FEED_LIMITS: FeedLimits = {
  maxChars: 4_000_000,
  maxItems: 100,
  maxTitleChars: 300,
  maxSnippetChars: 320,
  maxItemHtmlChars: 60_000,
};

export type FeedFormat = 'rss' | 'atom' | 'json';

export interface ParsedFeedItem {
  readonly guid?: string;
  readonly url?: string;
  readonly title: string;
  readonly snippet: string;
  readonly content: readonly SafeNode[];
  readonly imageUrl?: string;
  readonly author?: string;
  /** Epoch milliseconds, absent when the feed gives no usable date. */
  readonly publishedAt?: number;
}

export interface ParsedFeed {
  readonly format: FeedFormat;
  readonly title: string;
  readonly siteUrl?: string;
  readonly language?: string;
  readonly items: readonly ParsedFeedItem[];
  /** Entries that were dropped for having neither a title nor text. */
  readonly skipped: number;
}

export type FeedParseErrorCode = 'empty' | 'too-large' | 'not-a-feed' | 'malformed';

export class FeedParseError extends Error {
  readonly code: FeedParseErrorCode;

  constructor(code: FeedParseErrorCode, message: string) {
    super(message);
    this.name = 'FeedParseError';
    this.code = code;
  }
}

export interface ParseFeedOptions {
  /** Feed address: resolves relative item links. */
  readonly baseUrl?: string;
  readonly limits?: FeedLimits;
}

function clean(text: string | undefined): string {
  return plainTextFromHtml(text ?? '').trim();
}

function textOf(element: MarkupElement | undefined): string {
  return element ? textContent(element).trim() : '';
}

function firstText(element: MarkupElement, ...names: string[]): string {
  for (const name of names) {
    const value = textOf(findChild(element, name));
    if (value !== '') return value;
  }
  return '';
}

/** Dates in the wild: RFC 822, ISO 8601, and the occasional «2026-10-05 12:00:00». */
export function parseFeedDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const direct = Date.parse(trimmed);
  if (Number.isFinite(direct)) return direct;
  const spaced = Date.parse(trimmed.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:)/u, '$1T$2'));
  return Number.isFinite(spaced) ? spaced : undefined;
}

function itemFromParts(
  parts: {
    readonly guid?: string;
    readonly url?: string;
    readonly title: string;
    readonly summaryHtml: string;
    readonly contentHtml: string;
    readonly imageUrl?: string;
    readonly author?: string;
    readonly published?: string;
  },
  baseUrl: string | undefined,
  limits: FeedLimits,
): ParsedFeedItem | undefined {
  const title = snippetFrom(clean(parts.title), limits.maxTitleChars);
  const rich = parts.contentHtml !== '' ? parts.contentHtml : parts.summaryHtml;
  const sanitizeOptions = baseUrl ? { baseUrl } : {};
  const content = sanitizeFeedHtml(rich.slice(0, limits.maxItemHtmlChars), sanitizeOptions);
  const summaryText = clean(parts.summaryHtml.slice(0, limits.maxItemHtmlChars));
  const bodyText = summaryText !== '' ? summaryText : clean(rich.slice(0, limits.maxItemHtmlChars));
  const url = safeLinkUrl(parts.url, baseUrl);
  if (title === '' && bodyText === '' && !url) return undefined;
  const imageUrl =
    safeImageUrl(parts.imageUrl, baseUrl) ??
    (content.length > 0 ? firstImageOf(content) : undefined);
  const published = parseFeedDate(parts.published);
  const author = clean(parts.author).slice(0, 120);
  const snippet = snippetFrom(bodyText === title ? '' : bodyText, limits.maxSnippetChars);
  return {
    ...(parts.guid ? { guid: parts.guid.slice(0, 500) } : {}),
    ...(url ? { url } : {}),
    title: title === '' ? snippetFrom(bodyText, 120) || (url ?? '') : title,
    snippet,
    content: hasSafeContent(content) ? content : [],
    ...(imageUrl ? { imageUrl } : {}),
    ...(author ? { author } : {}),
    ...(published !== undefined ? { publishedAt: published } : {}),
  };
}

function mediaImage(element: MarkupElement): string | undefined {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;
    if (child.name === 'media:thumbnail' && child.attrs['url']) return child.attrs['url'];
    if (
      child.name === 'media:content' &&
      child.attrs['url'] &&
      (child.attrs['medium'] === 'image' || (child.attrs['type'] ?? '').startsWith('image/'))
    ) {
      return child.attrs['url'];
    }
    if (
      child.name === 'enclosure' &&
      child.attrs['url'] &&
      (child.attrs['type'] ?? '').startsWith('image/')
    ) {
      return child.attrs['url'];
    }
    if (child.name === 'media:group') {
      const nested = mediaImage(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

function rssItem(item: MarkupElement, baseUrl: string | undefined, limits: FeedLimits) {
  const guidElement = findChild(item, 'guid');
  const guid = textOf(guidElement) || item.attrs['rdf:about'] || '';
  const guidIsLink = guidElement?.attrs['ispermalink'] !== 'false' && /^https?:\/\//iu.test(guid);
  const link = firstText(item, 'link', 'feedburner:origlink') || (guidIsLink ? guid : '');
  const imageUrl = mediaImage(item);
  return itemFromParts(
    {
      ...(guid ? { guid } : {}),
      url: link || item.attrs['rdf:about'] || '',
      title: firstText(item, 'title'),
      summaryHtml: firstText(item, 'description', 'summary', 'dc:description', 'media:description'),
      contentHtml: firstText(item, 'content:encoded'),
      ...(imageUrl ? { imageUrl } : {}),
      author: firstText(item, 'dc:creator', 'author'),
      published: firstText(
        item,
        'pubdate',
        'dc:date',
        'prism:publicationdate',
        'prism:coverdate',
        'date',
      ),
    },
    baseUrl,
    limits,
  );
}

function atomLink(entry: MarkupElement): string {
  const links = findChildren(entry, 'link');
  const alternate =
    links.find(
      (link) => (link.attrs['rel'] ?? 'alternate') === 'alternate' && link.attrs['href'],
    ) ??
    links.find(
      (link) =>
        link.attrs['href'] && link.attrs['rel'] !== 'self' && link.attrs['rel'] !== 'enclosure',
    );
  return alternate?.attrs['href'] ?? '';
}

function atomText(element: MarkupElement | undefined): string {
  if (!element) return '';
  // `type="html"` carries escaped markup (already decoded to text by the tokenizer); `xhtml` real
  // child elements. Both end up as markup text for the sanitizer; plain `text` is escaped back.
  if (element.attrs['type'] === 'text') {
    return textContent(element).replace(/&/gu, '&amp;').replace(/</gu, '&lt;');
  }
  return textContent(element);
}

function atomEntry(entry: MarkupElement, baseUrl: string | undefined, limits: FeedLimits) {
  const authorName = textOf(findChild(findChild(entry, 'author') ?? entry, 'name'));
  const imageUrl = mediaImage(entry);
  const id = textOf(findChild(entry, 'id'));
  return itemFromParts(
    {
      ...(id ? { guid: id } : {}),
      url: atomLink(entry),
      title: atomText(findChild(entry, 'title')),
      summaryHtml: atomText(findChild(entry, 'summary')),
      contentHtml: atomText(findChild(entry, 'content')),
      ...(imageUrl ? { imageUrl } : {}),
      author: authorName,
      published: firstText(entry, 'published', 'updated', 'dc:date'),
    },
    baseUrl,
    limits,
  );
}

function limitItems(
  source: readonly (MarkupElement | undefined)[],
  build: (element: MarkupElement) => ParsedFeedItem | undefined,
  limits: FeedLimits,
): { items: ParsedFeedItem[]; skipped: number } {
  const items: ParsedFeedItem[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const element of source) {
    if (!element) continue;
    if (items.length >= limits.maxItems) break;
    const item = build(element);
    if (!item) {
      skipped += 1;
      continue;
    }
    const key = item.guid ?? item.url ?? `${item.title}|${item.publishedAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return { items, skipped };
}

function parseJsonFeed(text: string, baseUrl: string | undefined, limits: FeedLimits): ParsedFeed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FeedParseError('malformed', 'JSON Feed не разобран.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new FeedParseError('not-a-feed', 'Это не JSON Feed.');
  }
  const feed = data as Record<string, unknown>;
  const version = typeof feed['version'] === 'string' ? feed['version'] : '';
  if (!version.includes('jsonfeed.org') || !Array.isArray(feed['items'])) {
    throw new FeedParseError('not-a-feed', 'Это не JSON Feed.');
  }
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  const items: ParsedFeedItem[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of feed['items'] as unknown[]) {
    if (items.length >= limits.maxItems) break;
    if (typeof raw !== 'object' || raw === null) {
      skipped += 1;
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const authors = Array.isArray(entry['authors']) ? (entry['authors'] as unknown[]) : [];
    const firstAuthor = authors[0] ?? entry['author'];
    const authorName =
      typeof firstAuthor === 'object' && firstAuthor !== null
        ? str((firstAuthor as Record<string, unknown>)['name'])
        : '';
    const contentText = str(entry['content_text']);
    const escapedText = contentText.replace(/&/gu, '&amp;').replace(/</gu, '&lt;');
    const guid = str(entry['id']);
    const imageUrl = str(entry['image']) || str(entry['banner_image']);
    const item = itemFromParts(
      {
        ...(guid ? { guid } : {}),
        url: str(entry['url']) || str(entry['external_url']),
        title: str(entry['title']),
        summaryHtml: str(entry['summary']) || escapedText,
        contentHtml: str(entry['content_html']) || escapedText,
        ...(imageUrl ? { imageUrl } : {}),
        author: authorName,
        published: str(entry['date_published']) || str(entry['date_modified']),
      },
      baseUrl,
      limits,
    );
    if (!item) {
      skipped += 1;
      continue;
    }
    const key = item.guid ?? item.url ?? `${item.title}|${item.publishedAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  const siteUrl = safeLinkUrl(str(feed['home_page_url']), baseUrl);
  const language = str(feed['language']);
  return {
    format: 'json',
    title: clean(str(feed['title'])).slice(0, limits.maxTitleChars),
    ...(siteUrl ? { siteUrl } : {}),
    ...(language ? { language } : {}),
    items,
    skipped,
  };
}

/** XML forbids most C0 controls; feeds contain them anyway and a strict reader would reject the lot. */
function stripControlCharacters(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    out += text[index];
  }
  return out;
}

/**
 * Parses RSS 2.0, RSS 1.0 (RDF), Atom 1.0 and JSON Feed into a bounded, sanitized structure. Throws
 * {@link FeedParseError}; callers show the code's message, never the feed text.
 */
export function parseFeed(text: string, options: ParseFeedOptions = {}): ParsedFeed {
  const limits = options.limits ?? DEFAULT_FEED_LIMITS;
  if (text.length > limits.maxChars) {
    throw new FeedParseError('too-large', 'Лента слишком большая для чтения.');
  }
  const source = stripControlCharacters(text.replace(/^﻿/u, '')).trim();
  if (source === '') throw new FeedParseError('empty', 'Источник вернул пустой ответ.');
  if (source.startsWith('{')) return parseJsonFeed(source, options.baseUrl, limits);
  if (!source.startsWith('<')) {
    throw new FeedParseError('not-a-feed', 'Ответ не похож на ленту новостей.');
  }

  const root = parseMarkup(source, 'xml');
  const baseUrl = options.baseUrl;
  const rss = findDescendant(root, 'rss');
  const rdf = findDescendant(root, 'rdf:rdf');
  const atom = findDescendant(root, 'feed');

  if (rss || rdf) {
    const container = rss ?? (rdf as MarkupElement);
    const channel = findChild(container, 'channel');
    if (!channel) throw new FeedParseError('malformed', 'В ленте нет раздела channel.');
    const entries = rss ? findChildren(channel, 'item') : findChildren(container, 'item');
    const { items, skipped } = limitItems(
      entries,
      (item) => rssItem(item, baseUrl, limits),
      limits,
    );
    const siteUrl = safeLinkUrl(firstText(channel, 'link'), baseUrl);
    const language = firstText(channel, 'language', 'dc:language');
    return {
      format: 'rss',
      title: clean(firstText(channel, 'title')).slice(0, limits.maxTitleChars),
      ...(siteUrl ? { siteUrl } : {}),
      ...(language ? { language } : {}),
      items,
      skipped,
    };
  }
  if (atom) {
    const entries = findChildren(atom, 'entry');
    const { items, skipped } = limitItems(
      entries,
      (entry) => atomEntry(entry, baseUrl, limits),
      limits,
    );
    const siteLink = atomLink(atom);
    const siteUrl = safeLinkUrl(siteLink, baseUrl);
    const language = atom.attrs['xml:lang'] ?? '';
    return {
      format: 'atom',
      title: clean(atomText(findChild(atom, 'title'))).slice(0, limits.maxTitleChars),
      ...(siteUrl ? { siteUrl } : {}),
      ...(language ? { language } : {}),
      items,
      skipped,
    };
  }
  throw new FeedParseError('not-a-feed', 'Ответ не похож на ленту новостей.');
}
