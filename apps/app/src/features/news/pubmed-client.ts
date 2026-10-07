import type { ParsedFeedItem } from '@/features/news/feed-parser';
import type { FeedTransport } from '@/features/news/news-transport';
import {
  articleToFeedItem,
  buildEsearchUrl,
  buildEsummaryUrl,
  type PubmedArticle,
  parseEsearch,
  parseEsummary,
} from '@/features/news/pubmed';

/**
 * NCBI asks for at most 3 requests a second without an API key. A search is two requests (ids,
 * then summaries), so requests of every caller share one spacer at 2.5 a second.
 */
export const PUBMED_MIN_INTERVAL_MS = 400;

export interface PubmedSearchResult {
  /** The normalized search text this result answers. */
  readonly query: string;
  /** Matches in PubMed overall; `items` holds only the newest ones. */
  readonly total: number;
  /** The records as NCBI describes them (for the result list). */
  readonly articles: readonly PubmedArticle[];
  /** The same records as feed items (what a saved search stores). */
  readonly items: readonly ParsedFeedItem[];
}

export interface PubmedClient {
  search(query: string, signal?: AbortSignal): Promise<PubmedSearchResult>;
}

export interface PubmedClientDeps {
  readonly transport: FeedTransport;
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Hands out request slots at least `minIntervalMs` apart. Slots are reserved synchronously, so
 * concurrent callers (the refresh runs three sources at once) queue up instead of bursting.
 */
export function createRequestSpacer(
  minIntervalMs: number,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const current = now();
    const slot = Math.max(current, nextSlot);
    nextSlot = slot + minIntervalMs;
    if (slot > current) await sleep(slot - current);
  };
}

/**
 * PubMed search through the feed transport (so Android uses the native HTTP client and the browser
 * `fetch`): `esearch` for the newest PMIDs, then `esummary` for their records. The query text only
 * ever travels in the `esearch` address; nothing here logs it.
 */
export function createPubmedClient(deps: PubmedClientDeps): PubmedClient {
  const waitTurn = createRequestSpacer(
    deps.minIntervalMs ?? PUBMED_MIN_INTERVAL_MS,
    deps.now,
    deps.sleep,
  );
  return {
    async search(query, signal) {
      await waitTurn();
      const ids = parseEsearch(
        (await deps.transport.fetch({ url: buildEsearchUrl(query), signal })).text,
      );
      if (ids.ids.length === 0) return { query, total: ids.total, articles: [], items: [] };
      await waitTurn();
      const summary = await deps.transport.fetch({ url: buildEsummaryUrl(ids.ids), signal });
      const articles = parseEsummary(summary.text, ids.ids);
      return { query, total: ids.total, articles, items: articles.map(articleToFeedItem) };
    },
  };
}
