import {
  ARTICLE_SANITIZE_LIMITS,
  plainTextFromHtml,
  type SafeNode,
  safeImageUrl,
  safeLinkUrl,
  safeTextLength,
  sanitizeMarkupNodes,
} from '@/features/news/feed-content';
import { type MarkupElement, type MarkupNode, parseMarkup } from '@/features/news/markup';

/**
 * A readability-style extractor for the page of a feed item (ADR-0024, amended 2026-10-08): finds
 * the main text of an arbitrary news page and hands back the same kind of sanitized tree the feed
 * text uses. It works on the tolerant tokenizer's tree (no DOM, so it runs in tests and workers) and
 * never executes or loads anything: the page's scripts and styles are already gone after parsing.
 */
export interface ExtractedArticle {
  readonly title?: string;
  readonly byline?: string;
  /** The page's own cover (`og:image`), https only. */
  readonly imageUrl?: string;
  readonly content: readonly SafeNode[];
}

/** Below this much text the page is not an article (a home page, a paywall, a bot challenge). */
export const MIN_ARTICLE_CHARS = 280;
const MAX_HTML_CHARS = 1_500_000;

const NEVER_CONTENT = new Set([
  'script',
  'style',
  'noscript',
  'nav',
  'aside',
  'footer',
  'form',
  'iframe',
  'svg',
  'button',
  'select',
  'input',
  'textarea',
  'menu',
  'dialog',
  'template',
  'canvas',
  'object',
  'embed',
]);

const UNLIKELY =
  /(?:^|[\s_-])(?:comments?|respond|share|sharing|social|sidebar|side|related|recommend\w*|promo|adverts?|ads?|banner|breadcrumbs?|menu|navbar|nav|footer|subscribe|newsletter|popup|modal|cookie|tags?|rating|widget|pagination|pager|toolbar|print|author-box|more-news|read-also|ya-share\w*)(?:$|[\s_-])/iu;
const LIKELY = /(?:article|post|entry|content|text|body|story|news|main|detail|page)/iu;
const NEGATIVE = /(?:hidden|foot|comment|side|nav|related|share|social|banner|menu|widget|promo)/iu;
const TINY_IMAGE = /(?:pixel|spacer|blank|1x1|tracking|counter|sprite|avatar|emoji|logo|icon)/iu;

interface Measure {
  /** Characters of text below the element. */
  readonly text: number;
  /** Characters of that text inside links. */
  readonly link: number;
}

function attr(element: MarkupElement, name: string): string {
  return element.attrs[name] ?? '';
}

function labelOf(element: MarkupElement): string {
  return `${attr(element, 'class')} ${attr(element, 'id')}`;
}

function isHidden(element: MarkupElement): boolean {
  if (element.attrs['hidden'] !== undefined || attr(element, 'aria-hidden') === 'true') return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/iu.test(attr(element, 'style'));
}

function isUnlikely(element: MarkupElement): boolean {
  if (NEVER_CONTENT.has(element.name) || isHidden(element)) return true;
  const label = labelOf(element);
  return label.trim() !== '' && UNLIKELY.test(label) && !/article|body|content-text/iu.test(label);
}

function measureOf(element: MarkupElement, cache: Map<MarkupElement, Measure>): Measure {
  const known = cache.get(element);
  if (known) return known;
  let text = 0;
  let link = 0;
  for (const child of element.children) {
    if (child.kind === 'text') {
      text += child.text.trim().length;
      continue;
    }
    if (NEVER_CONTENT.has(child.name)) continue;
    const inner = measureOf(child, cache);
    text += inner.text;
    link += child.name === 'a' ? inner.text : inner.link;
  }
  const measure = { text, link };
  cache.set(element, measure);
  return measure;
}

function elementsOf(root: MarkupElement): MarkupElement[] {
  const out: MarkupElement[] = [];
  const walk = (element: MarkupElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function directText(element: MarkupElement): string {
  return element.children
    .map((child) => (child.kind === 'text' ? child.text : ''))
    .join('')
    .trim();
}

function plainTextOf(element: MarkupElement): string {
  const parts: string[] = [];
  const walk = (node: MarkupNode): void => {
    if (node.kind === 'text') parts.push(node.text);
    else if (!NEVER_CONTENT.has(node.name)) for (const child of node.children) walk(child);
  };
  walk(element);
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

interface Candidate {
  readonly element: MarkupElement;
  score: number;
}

interface Picked {
  readonly container: MarkupElement;
  /** Up to three ancestors, nearest first: the article's heading often sits just above its text. */
  readonly ancestors: readonly MarkupElement[];
}

function pickContainer(
  root: MarkupElement,
  cache: Map<MarkupElement, Measure>,
): Picked | undefined {
  const parents = new Map<MarkupElement, MarkupElement>();
  const link = (element: MarkupElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      parents.set(child, element);
      link(child);
    }
  };
  link(root);
  const candidates = new Map<MarkupElement, Candidate>();
  const candidateFor = (element: MarkupElement): Candidate => {
    let known = candidates.get(element);
    if (!known) {
      let score = 0;
      const label = labelOf(element);
      if (element.name === 'article') score += 30;
      else if (element.name === 'main') score += 12;
      if (attr(element, 'itemprop').toLowerCase() === 'articlebody') score += 60;
      if (LIKELY.test(label)) score += 20;
      if (NEGATIVE.test(label)) score -= 25;
      known = { element, score };
      candidates.set(element, known);
    }
    return known;
  };
  for (const element of elementsOf(root)) {
    if (element.name !== 'p' && element.name !== 'pre' && element.name !== 'blockquote') {
      // A text-bearing div without block children counts as a paragraph (old pages use <div><br>).
      const hasBlock = element.children.some(
        (child) =>
          child.kind === 'element' &&
          ['div', 'p', 'ul', 'ol', 'table', 'blockquote', 'section', 'article'].includes(
            child.name,
          ),
      );
      if (element.name !== 'div' || hasBlock || directText(element).length < 50) continue;
    }
    // An element inside an unlikely ancestor never feeds a candidate.
    let skip = false;
    for (let up = parents.get(element); up; up = parents.get(up)) {
      if (isUnlikely(up)) {
        skip = true;
        break;
      }
    }
    if (skip || isUnlikely(element)) continue;
    const measure = measureOf(element, cache);
    if (measure.text < 25) continue;
    const density = measure.link / Math.max(1, measure.text);
    if (density > 0.6) continue;
    const text = plainTextOf(element);
    const points =
      1 + (text.match(/[,;，]/gu)?.length ?? 0) + Math.min(3, Math.floor(measure.text / 100));
    const parent = parents.get(element);
    if (!parent) continue;
    candidateFor(parent).score += points;
    const grandparent = parents.get(parent);
    if (grandparent) candidateFor(grandparent).score += points / 2;
  }
  let best: Candidate | undefined;
  for (const candidate of candidates.values()) {
    const measure = measureOf(candidate.element, cache);
    const density = measure.link / Math.max(1, measure.text);
    const scaled = candidate.score * (1 - Math.min(0.95, density));
    candidate.score = scaled;
    if (!best || scaled > best.score) best = candidate;
  }
  if (!best) return undefined;
  const ancestors: MarkupElement[] = [];
  for (let up = parents.get(best.element); up && ancestors.length < 3; up = parents.get(up)) {
    if (up.name !== '#root' && up.name !== 'body' && up.name !== 'html') ancestors.push(up);
  }
  return { container: best.element, ancestors };
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const LAZY_SOURCES = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'];

function imageElement(element: MarkupElement): MarkupElement | undefined {
  let src = attr(element, 'src');
  if (src === '' || src.startsWith('data:')) {
    for (const name of LAZY_SOURCES) {
      if (attr(element, name) !== '') {
        src = attr(element, name);
        break;
      }
    }
  }
  if (src === '' || src.startsWith('data:') || TINY_IMAGE.test(`${src} ${labelOf(element)}`)) {
    return undefined;
  }
  const width = Number.parseInt(attr(element, 'width'), 10);
  const height = Number.parseInt(attr(element, 'height'), 10);
  if ((Number.isFinite(width) && width < 100) || (Number.isFinite(height) && height < 60)) {
    return undefined;
  }
  return { ...element, attrs: { ...element.attrs, src } };
}

/** The subtree without navigation, share bars, comments, link lists and the title's own heading. */
function cleaned(
  container: MarkupElement,
  title: string,
  cache: Map<MarkupElement, Measure>,
): MarkupNode[] {
  const wanted = normalized(title);
  let titleDropped = false;
  const walk = (nodes: readonly MarkupNode[]): MarkupNode[] => {
    const out: MarkupNode[] = [];
    for (const node of nodes) {
      if (node.kind === 'text') {
        out.push(node);
        continue;
      }
      if (node.name === 'img') {
        const image = imageElement(node);
        if (image) out.push(image);
        continue;
      }
      if (isUnlikely(node)) continue;
      const measure = measureOf(node, cache);
      if (/^h[1-6]$/u.test(node.name) && !titleDropped && wanted !== '') {
        const heading = normalized(plainTextOf(node));
        if (heading === wanted || (heading.length > 15 && wanted.includes(heading))) {
          titleDropped = true;
          continue;
        }
      }
      if (node.name === 'h1') continue;
      const density = measure.link / Math.max(1, measure.text);
      const block = ['div', 'ul', 'ol', 'section', 'table', 'p'].includes(node.name);
      // Link farms («Читайте также»): mostly links and short.
      if (block && measure.text > 0 && density > 0.65 && measure.text < 600) continue;
      const children = walk(node.children);
      // A wrapper emptied by the cleaning (a share bar's frame, an ad slot) is not content.
      if (children.length === 0 && node.name !== 'br' && node.name !== 'hr') continue;
      out.push({ ...node, children });
    }
    return out;
  };
  return walk(container.children);
}

function metaContent(metas: readonly MarkupElement[], ...keys: string[]): string {
  for (const key of keys) {
    for (const meta of metas) {
      const name = (attr(meta, 'property') || attr(meta, 'name')).toLowerCase();
      if (name === key && attr(meta, 'content').trim() !== '') return attr(meta, 'content').trim();
    }
  }
  return '';
}

function firstHeading(scope: MarkupElement): string {
  for (const element of elementsOf(scope)) {
    if (element.name !== 'h1' || isUnlikely(element)) continue;
    const text = plainTextOf(element);
    if (text.length >= 8 && text.length <= 300) return text;
  }
  return '';
}

/** The base address `<base href>` declares, else the page's own address. */
function baseOf(root: MarkupElement, pageUrl: string): string {
  const base = elementsOf(root).find((element) => element.name === 'base' && attr(element, 'href'));
  return base ? (safeLinkUrl(attr(base, 'href'), pageUrl) ?? pageUrl) : pageUrl;
}

/** Extracts the main article of a page; `undefined` when the page holds no article-sized text. */
export function extractArticle(html: string, pageUrl: string): ExtractedArticle | undefined {
  const root = parseMarkup(html.slice(0, MAX_HTML_CHARS), 'html');
  const cache = new Map<MarkupElement, Measure>();
  const base = baseOf(root, pageUrl);
  const picked = pickContainer(root, cache);
  if (!picked) return undefined;
  const { container, ancestors } = picked;
  const metas = elementsOf(root).filter((element) => element.name === 'meta');
  const documentTitle = elementsOf(root).find((element) => element.name === 'title');
  // The article's own heading, else the page's declared title; a site-wide <h1> («Центр СМИ») loses to it.
  const title =
    [container, ...ancestors].map(firstHeading).find((text) => text !== '') ||
    plainTextFromHtml(metaContent(metas, 'og:title', 'twitter:title')) ||
    firstHeading(root) ||
    (documentTitle ? plainTextOf(documentTitle) : '');
  const nodes = cleaned(container, title, cache);
  const content = sanitizeMarkupNodes(nodes, {
    baseUrl: base,
    limits: ARTICLE_SANITIZE_LIMITS,
  });
  if (safeTextLength(content) < MIN_ARTICLE_CHARS) return undefined;
  const byline = plainTextFromHtml(
    metaContent(metas, 'author', 'article:author', 'og:article:author'),
  );
  const cover = safeImageUrl(metaContent(metas, 'og:image', 'twitter:image'), base);
  return {
    ...(title ? { title: title.slice(0, 300) } : {}),
    ...(byline && !/^https?:/iu.test(byline) ? { byline: byline.slice(0, 120) } : {}),
    ...(cover ? { imageUrl: cover } : {}),
    content,
  };
}
