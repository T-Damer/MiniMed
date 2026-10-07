import { plainTextFromHtml, type SafeNode, snippetFrom } from '@/features/news/feed-content';
import { FeedParseError, type ParsedFeedItem } from '@/features/news/feed-parser';

/**
 * PubMed through NCBI E-utilities (ADR-0024): address builders, input checks and strict parsers for
 * the two JSON documents the feature reads. Pure and DOM-free; the request itself goes through the
 * feed transport (`pubmed-client.ts`). The search text is the user's clinical wording: it is never
 * logged and is sent to NCBI only when the user searches or refreshes a saved search.
 */

export const PUBMED_ESEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
export const PUBMED_ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
export const PUBMED_ARTICLE_BASE = 'https://pubmed.ncbi.nlm.nih.gov/';
/** NCBI asks every client to identify itself with `tool`. */
export const PUBMED_TOOL = 'minimed';

export const PUBMED_MIN_QUERY_CHARS = 2;
export const PUBMED_MAX_QUERY_CHARS = 300;
/** Newest results taken per search / refresh. */
export const PUBMED_RESULT_LIMIT = 25;

const PMID_PATTERN = /^\d{1,9}$/u;
const MAX_AUTHORS_KEPT = 12;
const MAX_AUTHORS_SHORT = 3;

export type PubmedQueryCheck =
  | { readonly ok: true; readonly query: string }
  | { readonly ok: false; readonly message: string };

/** Trims and bounds the search text; the check runs before anything is sent anywhere. */
export function normalizePubmedQuery(raw: string): PubmedQueryCheck {
  let query = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    query += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  query = query.replace(/\s+/gu, ' ').trim();
  if (query.length < PUBMED_MIN_QUERY_CHARS) {
    return { ok: false, message: 'Введите запрос: слово или фразу для поиска в PubMed.' };
  }
  if (query.length > PUBMED_MAX_QUERY_CHARS) {
    return {
      ok: false,
      message: `Запрос длиннее ${PUBMED_MAX_QUERY_CHARS} символов — сократите его.`,
    };
  }
  return { ok: true, query };
}

export function pubmedArticleUrl(pmid: string): string {
  return `${PUBMED_ARTICLE_BASE}${pmid}/`;
}

/** The PubMed web page of the same search: stored as the subscription address, opened only by the user. */
export function pubmedSearchPageUrl(query: string): string {
  const url = new URL(PUBMED_ARTICLE_BASE);
  url.searchParams.set('term', query);
  url.searchParams.set('sort', 'date');
  return url.href;
}

export function buildEsearchUrl(query: string, limit = PUBMED_RESULT_LIMIT): string {
  const url = new URL(PUBMED_ESEARCH_URL);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('retmode', 'json');
  // No `sort`: E-utilities' default order is newest-added first, while `sort=date` (the web page's
  // «Most recent») is not an E-utilities value and is ignored with a warning (measured 2026-10-07).
  url.searchParams.set('retmax', String(limit));
  url.searchParams.set('tool', PUBMED_TOOL);
  url.searchParams.set('term', query);
  return url.href;
}

export function buildEsummaryUrl(ids: readonly string[]): string {
  const url = new URL(PUBMED_ESUMMARY_URL);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('retmode', 'json');
  url.searchParams.set('tool', PUBMED_TOOL);
  url.searchParams.set('id', ids.join(','));
  return url.href;
}

function malformed(): FeedParseError {
  return new FeedParseError('malformed', 'PubMed вернул непонятный ответ.');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw malformed();
  }
  const root = record(data);
  if (!root) throw malformed();
  if (typeof root['error'] === 'string') {
    throw new FeedParseError('malformed', 'PubMed отклонил запрос. Повторите позже.');
  }
  return root;
}

export interface PubmedSearchIds {
  /** Number of matches in PubMed (not only the ones returned). */
  readonly total: number;
  readonly ids: readonly string[];
}

/** `esearch` response: the matching PMIDs, newest first. Anything off-shape is rejected. */
export function parseEsearch(text: string): PubmedSearchIds {
  const result = record(parseJson(text)['esearchresult']);
  if (!result) throw malformed();
  if (typeof result['ERROR'] === 'string') {
    throw new FeedParseError('malformed', 'PubMed не принял этот запрос.');
  }
  const list = result['idlist'];
  if (!Array.isArray(list)) throw malformed();
  const ids = (list as unknown[]).filter(
    (id): id is string => typeof id === 'string' && PMID_PATTERN.test(id),
  );
  if (ids.length !== list.length) throw malformed();
  const countRaw = result['count'];
  const total = Number(
    typeof countRaw === 'string' || typeof countRaw === 'number' ? countRaw : NaN,
  );
  return {
    total: Number.isFinite(total) && total >= ids.length ? Math.floor(total) : ids.length,
    ids: ids.slice(0, PUBMED_RESULT_LIMIT),
  };
}

export interface PubmedArticle {
  readonly pmid: string;
  readonly title: string;
  readonly journal: string;
  /** NCBI's own publication date text («2026 Oct 1», «2026 Oct»). */
  readonly pubdate: string;
  /**
   * When the record entered PubMed (its `entrez` history date), else the publication date: a feed
   * lists what is new, and a late-indexed article can carry a print date months in the past.
   */
  readonly publishedAt?: number;
  /** Author names as NCBI lists them (first twelve). */
  readonly authors: readonly string[];
  readonly doi?: string;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const RU_MONTHS = [
  'янв.',
  'февр.',
  'марта',
  'апр.',
  'мая',
  'июня',
  'июля',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
];

interface DateParts {
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
}

function dateParts(value: string): DateParts | undefined {
  const numeric = /^(\d{4})\/(\d{2})\/(\d{2})/u.exec(value);
  if (numeric) {
    return { year: Number(numeric[1]), month: Number(numeric[2]) - 1, day: Number(numeric[3]) };
  }
  const named = /^(\d{4})(?:\s+([A-Za-z]{3})[a-z]*)?(?:\s+(\d{1,2}))?/u.exec(value.trim());
  if (!named) return undefined;
  const month = named[2] ? MONTHS[named[2].toLowerCase()] : undefined;
  return {
    year: Number(named[1]),
    ...(month !== undefined ? { month } : {}),
    ...(month !== undefined && named[3] ? { day: Number(named[3]) } : {}),
  };
}

/** Epoch milliseconds (UTC midnight) of an NCBI date; month and day default to the first. */
export function parsePubmedDate(value: string | undefined): number | undefined {
  const parts = value ? dateParts(value) : undefined;
  if (!parts || parts.year < 1800 || parts.year > 2200) return undefined;
  return Date.UTC(parts.year, parts.month ?? 0, parts.day ?? 1);
}

/** «1 окт. 2026», «окт. 2026» or «2026», following how precise NCBI's date is. */
export function pubmedDateLabel(pubdate: string): string {
  const parts = dateParts(pubdate);
  if (!parts) return pubdate.slice(0, 30);
  if (parts.month === undefined) return String(parts.year);
  const month = RU_MONTHS[parts.month] ?? '';
  return parts.day === undefined ? `${month} ${parts.year}` : `${parts.day} ${month} ${parts.year}`;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? plainTextFromHtml(value, max).trim().slice(0, max) : '';
}

/** The `entrez` (else `pubmed`) date of an `esummary` history list, e.g. «2026/10/07 03:33». */
function entryDate(history: unknown): string | undefined {
  if (!Array.isArray(history)) return undefined;
  const dates = new Map<string, string>();
  for (const raw of history as unknown[]) {
    const item = record(raw);
    if (typeof item?.['pubstatus'] === 'string' && typeof item['date'] === 'string') {
      dates.set(item['pubstatus'], item['date']);
    }
  }
  return dates.get('entrez') ?? dates.get('pubmed');
}

function articleFrom(pmid: string, raw: unknown): PubmedArticle | undefined {
  const entry = record(raw);
  if (!entry || entry['error'] !== undefined) return undefined;
  const title = text(entry['title'], 600).replace(/\.$/u, '');
  if (title === '') return undefined;
  const authorList = Array.isArray(entry['authors']) ? (entry['authors'] as unknown[]) : [];
  const authors: string[] = [];
  for (const author of authorList) {
    const name = text(record(author)?.['name'], 80);
    if (name !== '') authors.push(name);
    if (authors.length >= MAX_AUTHORS_KEPT) break;
  }
  const ids = Array.isArray(entry['articleids']) ? (entry['articleids'] as unknown[]) : [];
  const doi = ids
    .map((id) => record(id))
    .find((id) => id?.['idtype'] === 'doi' && typeof id['value'] === 'string')?.['value'];
  const pubdate = text(entry['pubdate'], 40) || text(entry['epubdate'], 40);
  const sortDate = typeof entry['sortpubdate'] === 'string' ? entry['sortpubdate'] : undefined;
  const publishedAt =
    parsePubmedDate(entryDate(entry['history'])) ??
    parsePubmedDate(sortDate) ??
    parsePubmedDate(pubdate);
  const journal = text(entry['source'], 120) || text(entry['fulljournalname'], 120);
  return {
    pmid,
    title,
    journal,
    pubdate,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    authors,
    ...(typeof doi === 'string' && doi.length <= 120 ? { doi } : {}),
  };
}

/** `esummary` response for the PMIDs asked for, in the order asked; unusable records are dropped. */
export function parseEsummary(text: string, ids: readonly string[]): readonly PubmedArticle[] {
  const result = record(parseJson(text)['result']);
  if (!result) throw malformed();
  const articles: PubmedArticle[] = [];
  for (const pmid of ids) {
    const article = articleFrom(pmid, result[pmid]);
    if (article) articles.push(article);
  }
  return articles;
}

/** «Smith AB, Jones C, Lee D и др.» — the short form for lists. */
export function authorsShort(authors: readonly string[]): string {
  if (authors.length === 0) return '';
  const shown = authors.slice(0, MAX_AUTHORS_SHORT).join(', ');
  return authors.length > MAX_AUTHORS_SHORT ? `${shown} и др.` : shown;
}

function metaLine(article: PubmedArticle): string {
  const parts = [
    article.journal,
    article.pubdate ? pubmedDateLabel(article.pubdate) : '',
    authorsShort(article.authors),
  ].filter((part) => part !== '');
  return parts.join(' · ');
}

/** A PubMed record as a feed item: title, journal line and authors (no abstract: `esummary` has none). */
export function articleToFeedItem(article: PubmedArticle): ParsedFeedItem {
  const content: SafeNode[] = [];
  const journalLine = [article.journal, article.pubdate ? pubmedDateLabel(article.pubdate) : '']
    .filter((part) => part !== '')
    .join(' · ');
  if (journalLine !== '') content.push({ tag: 'p', children: [journalLine] });
  if (article.authors.length > 0) {
    content.push({ tag: 'p', children: [article.authors.join(', ')] });
  }
  const ids = [`PMID ${article.pmid}`, ...(article.doi ? [`DOI ${article.doi}`] : [])];
  content.push({ tag: 'p', children: [ids.join(' · ')] });
  content.push({
    tag: 'p',
    children: ['Аннотация и полный текст — на странице статьи в PubMed.'],
  });
  return {
    guid: `pmid:${article.pmid}`,
    url: pubmedArticleUrl(article.pmid),
    title: article.title,
    snippet: snippetFrom(metaLine(article), 320),
    content,
    ...(article.authors.length > 0 ? { author: authorsShort(article.authors) } : {}),
    ...(article.publishedAt !== undefined ? { publishedAt: article.publishedAt } : {}),
  };
}

/** The title a saved search gets until the user renames it. */
export function pubmedSubscriptionTitle(query: string): string {
  return `PubMed: ${snippetFrom(query, 60)}`;
}
