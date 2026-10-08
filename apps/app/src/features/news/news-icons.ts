import { safeLinkUrl } from '@/features/news/feed-content';
import { FeedFetchError, type FeedTransport } from '@/features/news/news-transport';
import { hostLabel, pageLinkElements } from '@/features/news/source-url';

/**
 * Source avatars (ADR-0024, amended 2026-10-08): the site's own icon, fetched once when the user
 * subscribes (or on a later refresh), shrunk and kept on the device as a small data URL. No icon
 * service is involved: the only hosts asked are the site the user already subscribed to.
 */

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'ico' | 'svg';

const MIME_BY_KIND: Readonly<Record<ImageKind, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** A stored avatar is at most this many characters of data URL (≈ 18 KB of image). */
export const MAX_ICON_DATA_CHARS = 24_000;
/** Largest icon file looked at; favicons are small, a big banner is not an avatar. */
export const MAX_ICON_BYTES = 300_000;
/** The page is fetched only to read its `<head>`; generous because the transport rejects, not clips. */
const PAGE_MAX_BYTES = 2_000_000;
const MAX_CANDIDATES = 4;
/** Avatars are drawn at most this wide (2 × the 3.5 rem modal avatar on a dense screen). */
export const ICON_PIXELS = 112;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** The kind of an image by its first bytes: the server's content type is not trusted. */
export function sniffImageKind(bytes: Uint8Array): ImageKind | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'webp';
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  const head = new TextDecoder().decode(bytes.slice(0, 400)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return undefined;
}

export function bytesToDataUrl(bytes: Uint8Array, kind: ImageKind): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${MIME_BY_KIND[kind]};base64,${btoa(binary)}`;
}

/** Only an image data URL of a sane size is ever stored or drawn. */
export function isStoredIconData(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_ICON_DATA_CHARS &&
    /^data:image\/(?:png|jpeg|gif|webp|x-icon|svg\+xml);base64,[A-Za-z0-9+/=]+$/u.test(value)
  );
}

/** Re-encodes an image as a small square-fitted PNG; `undefined` when it cannot be decoded. */
export type IconShrinker = (bytes: Uint8Array, kind: ImageKind) => Promise<string | undefined>;

/**
 * Browser shrinker: decodes with an `<img>` (so ICO and SVG work too) and redraws into a small
 * canvas. Absent outside a browser, where the original is kept only if it is already small.
 */
export function createCanvasIconShrinker(): IconShrinker | undefined {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  return async (bytes, kind) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME_BY_KIND[kind] }));
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = ICON_PIXELS;
      canvas.height = ICON_PIXELS;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      const width = image.naturalWidth || ICON_PIXELS;
      const height = image.naturalHeight || ICON_PIXELS;
      const scale = Math.min(ICON_PIXELS / width, ICON_PIXELS / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      context.drawImage(
        image,
        (ICON_PIXELS - drawWidth) / 2,
        (ICON_PIXELS - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      return canvas.toDataURL('image/png');
    } catch {
      // An undecodable file is an expected outcome (the next candidate is tried).
      return undefined;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

function sizeOf(sizes: string | undefined): number {
  const match = /(\d+)\s*x\s*(\d+)/iu.exec(sizes ?? '');
  return match ? Math.min(Number(match[1]), Number(match[2])) : 0;
}

/**
 * Icon addresses to try, best first: a large `apple-touch-icon`, a sized `icon` link (closest to
 * 128 px), an unsized one, the feed's own image and finally `/favicon.ico`. Addresses resolve
 * against the page; anything that is not http(s) is dropped.
 */
export function iconCandidates(
  html: string,
  pageUrl: string,
  feedIconUrl?: string,
): readonly string[] {
  const scored: { readonly url: string; readonly score: number }[] = [];
  for (const link of pageLinkElements(html)) {
    const rel = (link.attrs['rel'] ?? '').toLowerCase().split(/\s+/u);
    const touch = rel.some((token) => token.startsWith('apple-touch-icon'));
    const icon = rel.includes('icon');
    if (!touch && !icon) continue;
    const url = safeLinkUrl(link.attrs['href'], pageUrl);
    if (!url || !/^https?:/u.test(url)) continue;
    const size = sizeOf(link.attrs['sizes']);
    const sizeScore = size === 0 ? 0 : 50 - Math.min(50, Math.abs(size - 128) / 4);
    scored.push({ url, score: (touch ? 200 : 100) + sizeScore });
  }
  scored.sort((left, right) => right.score - left.score);
  const urls = scored.map((entry) => entry.url);
  const feedIcon = safeLinkUrl(feedIconUrl, pageUrl);
  if (feedIcon) urls.push(feedIcon);
  try {
    urls.push(new URL('/favicon.ico', pageUrl).href);
  } catch {
    // An unparsable page address has no default icon location.
  }
  return [...new Set(urls)].slice(0, MAX_CANDIDATES);
}

export interface FetchIconOptions {
  readonly transport: FeedTransport;
  readonly shrink?: IconShrinker | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Finds and downloads the avatar of a site: reads its home page for icon links, then tries the
 * candidates in order. Returns `undefined` when nothing usable was found; a failing candidate only
 * moves on to the next one, because «no icon» is a normal outcome (the avatar is then a monogram).
 */
export async function fetchSourceIcon(
  options: FetchIconOptions & { readonly siteUrl: string; readonly feedIconUrl?: string },
): Promise<string | undefined> {
  const { transport, shrink, signal, siteUrl, feedIconUrl } = options;
  let page: { readonly html: string; readonly url: string } = { html: '', url: siteUrl };
  try {
    const response = await transport.fetch({
      url: siteUrl,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      maxBytes: PAGE_MAX_BYTES,
      timeoutMs: 8000,
      signal,
    });
    page = { html: response.text, url: response.finalUrl };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!(error instanceof FeedFetchError)) throw error;
    // The home page is unreadable (CORS in a browser, a timeout): try the feed image and favicon.ico.
  }
  for (const url of iconCandidates(page.html, page.url, feedIconUrl)) {
    try {
      const response = await transport.fetch({
        url,
        accept: 'image/*,*/*;q=0.5',
        binary: true,
        maxBytes: MAX_ICON_BYTES,
        timeoutMs: 8000,
        signal,
      });
      const bytes = response.bytes;
      const kind = bytes ? sniffImageKind(bytes) : undefined;
      if (!bytes || !kind) continue;
      const data = shrink ? await shrink(bytes, kind) : bytesToDataUrl(bytes, kind);
      if (isStoredIconData(data)) return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof FeedFetchError)) throw error;
      // This candidate is unreachable or too large; the next one may work.
    }
  }
  return undefined;
}

/** Key of a source's avatar: the host of its site, so a feed and the site share one icon. */
export function iconKeyFor(url: string): string {
  return hostLabel(url);
}

/** Retry a source without an icon at most once in this long. */
export const ICON_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
