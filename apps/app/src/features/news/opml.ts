import { type MarkupElement, parseMarkup } from '@/features/news/markup';
import type { Subscription } from '@/features/news/news-types';
import { normalizeSourceUrl } from '@/features/news/source-url';

export interface OpmlEntry {
  readonly title: string;
  readonly url: string;
  /** `rss` entries are feeds; `link` entries are websites. */
  readonly kind: 'feed' | 'site';
}

export const OPML_MAX_ENTRIES = 100;

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** OPML 2.0 export of the subscriptions (titles and addresses only: no read state, no items). */
export function buildOpml(
  subscriptions: readonly Subscription[],
  title = 'MiniMed — лента',
): string {
  const outlines = subscriptions
    .map((subscription) => {
      const text = escapeXml(subscription.title);
      const url = escapeXml(subscription.url);
      return subscription.kind === 'feed'
        ? `    <outline type="rss" text="${text}" title="${text}" xmlUrl="${url}"/>`
        : `    <outline type="link" text="${text}" title="${text}" url="${url}"/>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${escapeXml(title)}</title>\n  </head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`;
}

function collect(element: MarkupElement, out: OpmlEntry[]): void {
  for (const child of element.children) {
    if (child.kind !== 'element' || out.length >= OPML_MAX_ENTRIES) continue;
    if (child.name === 'outline') {
      const feedUrl = child.attrs['xmlurl'];
      const siteUrl = child.attrs['url'] ?? child.attrs['htmlurl'];
      const title = (child.attrs['title'] ?? child.attrs['text'] ?? '').trim().slice(0, 120);
      const raw = feedUrl ?? (child.attrs['type'] === 'link' ? siteUrl : undefined);
      if (raw) {
        const normalized = normalizeSourceUrl(raw);
        if (normalized.ok) {
          out.push({
            title,
            url: normalized.url,
            kind: feedUrl ? 'feed' : 'site',
          });
        }
      }
    }
    collect(child, out);
  }
}

/** Entries of an OPML file; nested folders are flattened, invalid addresses skipped. */
export function parseOpml(text: string): readonly OpmlEntry[] {
  const root = parseMarkup(text.slice(0, 1_000_000), 'xml');
  const entries: OpmlEntry[] = [];
  collect(root, entries);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
