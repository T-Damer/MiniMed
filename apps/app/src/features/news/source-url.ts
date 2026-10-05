import { safeLinkUrl } from '@/features/news/feed-content';
import { type MarkupElement, parseMarkup } from '@/features/news/markup';

export type SourceUrlResult =
  | { readonly ok: true; readonly url: string }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'invalid' | 'scheme' | 'credentials';
      readonly message: string;
    };

const REASON_MESSAGES = {
  empty: 'Вставьте адрес ленты или сайта.',
  invalid: 'Адрес не похож на ссылку. Пример: https://example.org/feed.xml',
  scheme: 'Поддерживаются только ссылки http и https.',
  credentials: 'Уберите логин и пароль из адреса: приложение не хранит пароли.',
} as const;

function fail(reason: keyof typeof REASON_MESSAGES): SourceUrlResult {
  return { ok: false, reason, message: REASON_MESSAGES[reason] };
}

/** Turns what the user pasted into an absolute http(s) address, or says why it is not one. */
export function normalizeSourceUrl(input: string): SourceUrlResult {
  const trimmed = input.trim();
  if (trimmed === '') return fail('empty');
  if (/\s/u.test(trimmed)) return fail('invalid');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^[^/]*:\d+(?:\/|$)/u.test(trimmed);
  // `feed://host/path` and `rss://…` are the old subscription schemes: they mean https.
  const withScheme = /^(?:feed|rss|pcast):\/\//iu.test(trimmed)
    ? `https://${trimmed.replace(/^[a-z]+:\/\//iu, '')}`
    : hasScheme
      ? trimmed
      : `https://${trimmed.replace(/^\/\//u, '')}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return fail('invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fail('scheme');
  if (parsed.username !== '' || parsed.password !== '') return fail('credentials');
  const host = parsed.hostname;
  const looksLikeHost = host.includes('.') || host === 'localhost' || host.includes(':');
  if (host === '' || !looksLikeHost) return fail('invalid');
  parsed.hash = '';
  return { ok: true, url: parsed.href };
}

export type PayloadKind = 'feed' | 'html' | 'unknown';

/** Whether a fetched body is a feed, a web page or neither (looked at, never executed). */
export function classifyPayload(text: string, contentType = ''): PayloadKind {
  const head = text.replace(/^﻿/u, '').trimStart().slice(0, 4000).toLowerCase();
  if (head.startsWith('{')) return head.includes('jsonfeed.org') ? 'feed' : 'unknown';
  const type = contentType.toLowerCase();
  if (
    /<(?:rss|feed|rdf:rdf)[\s>]/u.test(head) &&
    !/<!doctype html|<html[\s>]/u.test(head.slice(0, 600))
  ) {
    return 'feed';
  }
  if (type.includes('rss') || type.includes('atom')) {
    return head.startsWith('<') ? 'feed' : 'unknown';
  }
  if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/u.test(head) || type.includes('html')) {
    return 'html';
  }
  return 'unknown';
}

export interface DiscoveredFeed {
  readonly url: string;
  readonly title: string;
  readonly format: 'rss' | 'atom' | 'json';
}

const FEED_LINK_TYPES: Readonly<Record<string, DiscoveredFeed['format']>> = {
  'application/rss+xml': 'rss',
  'application/atom+xml': 'atom',
  'application/feed+json': 'json',
  'application/json': 'json',
  'application/rdf+xml': 'rss',
};

function collectLinks(element: MarkupElement, out: MarkupElement[]): void {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;
    if (child.name === 'link') out.push(child);
    else if (child.name === 'head' || child.name === 'html' || child.name === '#root') {
      collectLinks(child, out);
    }
  }
}

/** `<link rel="alternate" type="application/rss+xml">` declarations of a page, resolved against it. */
export function discoverFeedLinks(html: string, pageUrl: string): readonly DiscoveredFeed[] {
  const root = parseMarkup(html.slice(0, 200_000), 'html');
  const links: MarkupElement[] = [];
  collectLinks(root, links);
  const found: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const rel = (link.attrs['rel'] ?? '').toLowerCase().split(/\s+/u);
    if (!rel.includes('alternate')) continue;
    const type = (link.attrs['type'] ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
    const format = FEED_LINK_TYPES[type];
    if (!format) continue;
    const url = safeLinkUrl(link.attrs['href'], pageUrl);
    if (!url || !/^https?:/u.test(url) || seen.has(url)) continue;
    seen.add(url);
    found.push({ url, format, title: (link.attrs['title'] ?? '').trim().slice(0, 120) });
  }
  return found.slice(0, 8);
}

/** The page title, for naming a website subscription. */
export function pageTitleOf(html: string): string {
  const match = /<title[^>]*>([\s\S]{1,300}?)<\/title>/iu.exec(html.slice(0, 100_000));
  if (!match) return '';
  const root = parseMarkup(match[1] ?? '', 'html');
  const text = root.children.map((child) => (child.kind === 'text' ? child.text : '')).join('');
  return text.replace(/\s+/gu, ' ').trim().slice(0, 120);
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}
