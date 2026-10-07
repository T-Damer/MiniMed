import { describe, expect, it } from 'vitest';

import {
  FeedFetchError,
  type FeedRequest,
  type FeedTransport,
} from '@/features/news/news-transport';
import { createPubmedClient, createRequestSpacer } from '@/features/news/pubmed-client';

function transportOf(handler: (request: FeedRequest) => string): {
  readonly transport: FeedTransport;
  readonly requests: FeedRequest[];
} {
  const requests: FeedRequest[] = [];
  return {
    requests,
    transport: {
      kind: 'web',
      conditional: false,
      fetch: async (request) => {
        requests.push(request);
        return {
          status: 200,
          notModified: false,
          text: handler(request),
          finalUrl: request.url,
          headers: { 'content-type': 'application/json' },
        };
      },
    },
  };
}

const ESEARCH = JSON.stringify({
  esearchresult: { count: '2', idlist: ['11', '22'] },
});
const ESUMMARY = JSON.stringify({
  result: {
    uids: ['11', '22'],
    '11': { uid: '11', title: 'First.', source: 'Lancet', pubdate: '2026 Oct 2', authors: [] },
    '22': { uid: '22', title: 'Second.', source: 'BMJ', pubdate: '2026 Sep', authors: [] },
  },
});

describe('createRequestSpacer', () => {
  it('spaces concurrent callers by the interval without a burst', async () => {
    const slept: number[] = [];
    const wait = createRequestSpacer(
      400,
      () => 1000,
      async (ms) => {
        slept.push(ms);
      },
    );
    await Promise.all([wait(), wait(), wait()]);
    // The first goes at once, the next two are queued 400 ms apart.
    expect(slept).toEqual([400, 800]);
  });

  it('does not delay a caller that arrives after the interval has passed', async () => {
    let clock = 0;
    const slept: number[] = [];
    const wait = createRequestSpacer(
      400,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    );
    await wait();
    clock += 1000;
    await wait();
    expect(slept).toEqual([]);
  });
});

describe('createPubmedClient', () => {
  it('searches ids, then summaries, and spaces the two requests', async () => {
    const { transport, requests } = transportOf((request) =>
      request.url.includes('esearch') ? ESEARCH : ESUMMARY,
    );
    const slept: number[] = [];
    let clock = 0;
    const client = createPubmedClient({
      transport,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    const result = await client.search('glaucoma');
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/entrez/eutils/esearch.fcgi',
      '/entrez/eutils/esummary.fcgi',
    ]);
    expect(new URL(requests[1]?.url ?? '').searchParams.get('id')).toBe('11,22');
    expect(slept).toEqual([400]);
    expect(result.total).toBe(2);
    expect(result.articles.map((article) => article.title)).toEqual(['First', 'Second']);
    expect(result.items.map((item) => item.url)).toEqual([
      'https://pubmed.ncbi.nlm.nih.gov/11/',
      'https://pubmed.ncbi.nlm.nih.gov/22/',
    ]);
  });

  it('skips the summary request when nothing matches', async () => {
    const { transport, requests } = transportOf(() =>
      JSON.stringify({ esearchresult: { count: '0', idlist: [] } }),
    );
    const result = await createPubmedClient({ transport }).search('zzzz-no-such-term');
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ total: 0, articles: [], items: [] });
  });

  it('passes transport failures through and rejects a malformed answer', async () => {
    const failing: FeedTransport = {
      kind: 'web',
      conditional: false,
      fetch: async () => {
        throw new FeedFetchError('offline', 'offline-message');
      },
    };
    await expect(createPubmedClient({ transport: failing }).search('x y')).rejects.toMatchObject({
      code: 'offline',
    });
    const garbage = transportOf(() => '<html>blocked</html>');
    await expect(
      createPubmedClient({ transport: garbage.transport }).search('x y'),
    ).rejects.toMatchObject({ code: 'malformed' });
  });
});
