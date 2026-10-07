import { describe, expect, it } from 'vitest';

import { FeedParseError } from '@/features/news/feed-parser';
import {
  articleToFeedItem,
  authorsShort,
  buildEsearchUrl,
  buildEsummaryUrl,
  normalizePubmedQuery,
  parseEsearch,
  parseEsummary,
  parsePubmedDate,
  pubmedArticleUrl,
  pubmedDateLabel,
  pubmedSearchPageUrl,
  pubmedSubscriptionTitle,
} from '@/features/news/pubmed';

const ESEARCH = JSON.stringify({
  header: { type: 'esearch', version: '0.3' },
  esearchresult: {
    count: '1234',
    retmax: '3',
    retstart: '0',
    idlist: ['41000003', '41000002', '41000001'],
  },
});

function record(uid: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    pubdate: '2026 Oct 1',
    epubdate: '2026 Sep 20',
    source: 'J Clin Oncol',
    authors: [
      { name: 'Smith AB', authtype: 'Author' },
      { name: 'Doe C', authtype: 'Author' },
      { name: 'Lee D', authtype: 'Author' },
      { name: 'Kim E', authtype: 'Author' },
    ],
    title: 'Adjuvant <i>therapy</i> in glaucoma &amp; retina.',
    sortpubdate: '2026/10/01 00:00',
    articleids: [
      { idtype: 'pubmed', value: uid },
      { idtype: 'doi', value: '10.1000/xyz' },
    ],
    ...extra,
  };
}

const ESUMMARY = JSON.stringify({
  header: { type: 'esummary' },
  result: {
    uids: ['41000003', '41000002', '41000001'],
    '41000003': record('41000003'),
    '41000002': { uid: '41000002', error: 'cannot get document summary' },
    '41000001': record('41000001', { title: '   ' }),
  },
});

describe('PubMed entry date', () => {
  it('lists a record by when it entered PubMed, falling back to its publication date', () => {
    const late = JSON.stringify({
      result: {
        '7': record('7', {
          pubdate: '2025 Mar',
          sortpubdate: '2025/03/01 00:00',
          history: [
            { pubstatus: 'pubmed', date: '2026/10/06 05:31' },
            { pubstatus: 'entrez', date: '2026/10/05 03:33' },
          ],
        }),
        '8': record('8', { pubdate: '2025 Mar', sortpubdate: '2025/03/01 00:00' }),
      },
    });
    const [first, second] = parseEsummary(late, ['7', '8']);
    expect(first?.publishedAt).toBe(Date.UTC(2026, 9, 5));
    // The label keeps showing the publication date.
    expect(first?.pubdate).toBe('2025 Mar');
    expect(second?.publishedAt).toBe(Date.UTC(2025, 2, 1));
  });
});

describe('PubMed query', () => {
  it('trims, collapses whitespace and bounds the text before anything is sent', () => {
    expect(normalizePubmedQuery('  glaucoma \n\t treatment ')).toEqual({
      ok: true,
      query: 'glaucoma treatment',
    });
    expect(normalizePubmedQuery('a')).toMatchObject({ ok: false });
    expect(normalizePubmedQuery('   ')).toMatchObject({ ok: false });
    expect(normalizePubmedQuery('x'.repeat(301))).toMatchObject({ ok: false });
    expect(normalizePubmedQuery('x'.repeat(300))).toMatchObject({ ok: true });
  });
});

describe('PubMed addresses', () => {
  it('builds esearch with the tool name, the default newest-first order and an encoded term', () => {
    const url = new URL(buildEsearchUrl('glaucoma AND "retinal detachment"&x=1'));
    expect(url.origin + url.pathname).toBe(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
    );
    expect(url.searchParams.get('db')).toBe('pubmed');
    expect(url.searchParams.get('retmode')).toBe('json');
    // `sort=date` is not an E-utilities value; the default order is newest first.
    expect(url.searchParams.get('sort')).toBeNull();
    expect(url.searchParams.get('tool')).toBe('minimed');
    expect(url.searchParams.get('retmax')).toBe('25');
    // The term survives intact and cannot smuggle in a second parameter.
    expect(url.searchParams.get('term')).toBe('glaucoma AND "retinal detachment"&x=1');
    expect(url.searchParams.get('x')).toBeNull();
  });

  it('builds esummary for a comma-separated id list', () => {
    const url = new URL(buildEsummaryUrl(['1', '22', '333']));
    expect(url.pathname).toBe('/entrez/eutils/esummary.fcgi');
    expect(url.searchParams.get('id')).toBe('1,22,333');
    expect(url.searchParams.get('tool')).toBe('minimed');
  });

  it('links an article and the web page of a search', () => {
    expect(pubmedArticleUrl('123')).toBe('https://pubmed.ncbi.nlm.nih.gov/123/');
    const page = new URL(pubmedSearchPageUrl('glaucoma treatment'));
    expect(page.origin).toBe('https://pubmed.ncbi.nlm.nih.gov');
    expect(page.searchParams.get('term')).toBe('glaucoma treatment');
  });
});

describe('parseEsearch', () => {
  it('reads the ids and the total', () => {
    expect(parseEsearch(ESEARCH)).toEqual({
      total: 1234,
      ids: ['41000003', '41000002', '41000001'],
    });
  });

  it('accepts an empty result', () => {
    expect(parseEsearch(JSON.stringify({ esearchresult: { count: '0', idlist: [] } }))).toEqual({
      total: 0,
      ids: [],
    });
  });

  it('rejects anything off-shape instead of guessing', () => {
    const code = (text: string): string | undefined => {
      try {
        parseEsearch(text);
      } catch (error) {
        return error instanceof FeedParseError ? error.code : 'other';
      }
      return undefined;
    };
    expect(code('<html>')).toBe('malformed');
    expect(code('[]')).toBe('malformed');
    expect(code('{}')).toBe('malformed');
    expect(code(JSON.stringify({ esearchresult: { idlist: 'nope' } }))).toBe('malformed');
    expect(code(JSON.stringify({ esearchresult: { idlist: ['12', '<script>'] } }))).toBe(
      'malformed',
    );
    expect(code(JSON.stringify({ esearchresult: { idlist: ['1'], ERROR: 'Invalid query' } }))).toBe(
      'malformed',
    );
    expect(code(JSON.stringify({ error: 'API rate limit exceeded', count: '4' }))).toBe(
      'malformed',
    );
  });
});

describe('parseEsummary', () => {
  it('keeps the order asked for, strips markup from titles and drops unusable records', () => {
    const articles = parseEsummary(ESUMMARY, ['41000003', '41000002', '41000001', '41999999']);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      pmid: '41000003',
      title: 'Adjuvant therapy in glaucoma & retina',
      journal: 'J Clin Oncol',
      pubdate: '2026 Oct 1',
      doi: '10.1000/xyz',
      publishedAt: Date.UTC(2026, 9, 1),
    });
    expect(articles[0]?.authors).toEqual(['Smith AB', 'Doe C', 'Lee D', 'Kim E']);
  });

  it('rejects a document that is not an esummary result', () => {
    expect(() => parseEsummary('{"nope":1}', ['1'])).toThrowError(FeedParseError);
    expect(() => parseEsummary('not json', ['1'])).toThrowError(FeedParseError);
  });
});

describe('PubMed dates and authors', () => {
  it('parses NCBI dates to UTC midnight with month and day defaults', () => {
    expect(parsePubmedDate('2026/10/05 00:00')).toBe(Date.UTC(2026, 9, 5));
    expect(parsePubmedDate('2026 Oct 5')).toBe(Date.UTC(2026, 9, 5));
    expect(parsePubmedDate('2026 Oct')).toBe(Date.UTC(2026, 9, 1));
    expect(parsePubmedDate('2026')).toBe(Date.UTC(2026, 0, 1));
    expect(parsePubmedDate('soon')).toBeUndefined();
    expect(parsePubmedDate(undefined)).toBeUndefined();
  });

  it('labels a date as precisely as NCBI gave it', () => {
    expect(pubmedDateLabel('2026 Oct 1')).toBe('1 окт. 2026');
    expect(pubmedDateLabel('2026 Oct')).toBe('окт. 2026');
    expect(pubmedDateLabel('2026')).toBe('2026');
  });

  it('shortens the author list to three names', () => {
    expect(authorsShort([])).toBe('');
    expect(authorsShort(['A B', 'C D'])).toBe('A B, C D');
    expect(authorsShort(['A', 'B', 'C', 'D'])).toBe('A, B, C и др.');
  });
});

describe('articleToFeedItem', () => {
  const article = parseEsummary(ESUMMARY, ['41000003'])[0];

  it('becomes a feed item that links to PubMed and carries the record text', () => {
    expect(article).toBeDefined();
    if (!article) return;
    const item = articleToFeedItem(article);
    expect(item.guid).toBe('pmid:41000003');
    expect(item.url).toBe('https://pubmed.ncbi.nlm.nih.gov/41000003/');
    expect(item.title).toBe('Adjuvant therapy in glaucoma & retina');
    expect(item.snippet).toBe('J Clin Oncol · 1 окт. 2026 · Smith AB, Doe C, Lee D и др.');
    expect(item.author).toBe('Smith AB, Doe C, Lee D и др.');
    expect(item.publishedAt).toBe(Date.UTC(2026, 9, 1));
    expect(item.imageUrl).toBeUndefined();
    const text = JSON.stringify(item.content);
    expect(text).toContain('PMID 41000003');
    expect(text).toContain('DOI 10.1000/xyz');
    expect(text).not.toContain('<');
  });

  it('titles a saved search from its text', () => {
    expect(pubmedSubscriptionTitle('glaucoma')).toBe('PubMed: glaucoma');
    expect(pubmedSubscriptionTitle('x'.repeat(200)).length).toBeLessThan(80);
  });
});
