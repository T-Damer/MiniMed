import { type MarkupElement, type MarkupNode, parseMarkup } from '@/features/news/markup';

/**
 * Untrusted feed HTML becomes a small tree of allow-listed elements (ADR-0024). The tree is
 * rendered with DOM element creation, never with `innerHTML`, so a parser disagreement cannot turn
 * feed text into script: only the tags below exist, and the only attributes that survive are a
 * checked `href`, `src` and `alt`.
 */
export type SafeTag =
  | 'p'
  | 'div'
  | 'br'
  | 'a'
  | 'strong'
  | 'em'
  | 'ul'
  | 'ol'
  | 'li'
  | 'blockquote'
  | 'h4'
  | 'pre'
  | 'code'
  | 'sup'
  | 'sub'
  | 'img';

export interface SafeElement {
  readonly tag: SafeTag;
  readonly href?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly children?: readonly SafeNode[];
}

/** A string is a text node. */
export type SafeNode = string | SafeElement;

export interface SanitizeLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTextChars: number;
}

export const DEFAULT_SANITIZE_LIMITS: SanitizeLimits = {
  maxDepth: 12,
  maxNodes: 1500,
  maxTextChars: 16_000,
};

/** An extracted article is far longer than a feed teaser: its own, still bounded, limits. */
export const ARTICLE_SANITIZE_LIMITS: SanitizeLimits = {
  maxDepth: 24,
  maxNodes: 8000,
  maxTextChars: 80_000,
};

const TAG_MAP: Readonly<Record<string, SafeTag>> = {
  p: 'p',
  div: 'div',
  section: 'div',
  article: 'div',
  figure: 'div',
  figcaption: 'div',
  tr: 'div',
  br: 'br',
  a: 'a',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  blockquote: 'blockquote',
  h1: 'h4',
  h2: 'h4',
  h3: 'h4',
  h4: 'h4',
  h5: 'h4',
  h6: 'h4',
  pre: 'pre',
  code: 'code',
  sup: 'sup',
  sub: 'sub',
  img: 'img',
};

/** Elements whose content is not text for a reader and is removed together with the element. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'template',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'form',
  'select',
  'textarea',
  'button',
  'head',
  'title',
  'meta',
  'link',
  'base',
]);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'figure',
  'figcaption',
  'tr',
  'br',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
]);

/** A link target a reader may follow: absolute http(s) or mail; anything else is dropped. */
export function safeLinkUrl(value: string | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim();
  if (candidate === '' || candidate.length > 2048) return undefined;
  try {
    const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'mailto:') return parsed.href;
  } catch {
    return undefined;
  }
  return undefined;
}

/** An image source: https only (the app is served over https; a remote http image would be blocked anyway). */
export function safeImageUrl(value: string | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim();
  if (candidate === '' || candidate.length > 2048) return undefined;
  try {
    const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export interface SanitizeOptions {
  /** Resolves relative links and image sources. */
  readonly baseUrl?: string;
  readonly limits?: SanitizeLimits;
}

interface SanitizeState {
  nodes: number;
  textChars: number;
  truncated: boolean;
  readonly limits: SanitizeLimits;
  readonly baseUrl: string | undefined;
}

function collapse(text: string): string {
  return text.replace(/[\s ]+/gu, ' ');
}

function walk(node: MarkupNode, state: SanitizeState, depth: number): SafeNode[] {
  if (state.truncated) return [];
  if (node.kind === 'text') {
    const text = collapse(node.text);
    if (text === '' || text === ' ') return text === ' ' ? [' '] : [];
    const room = state.limits.maxTextChars - state.textChars;
    if (room <= 0) {
      state.truncated = true;
      return [];
    }
    const clipped = text.length > room ? text.slice(0, room) : text;
    if (text.length > room) state.truncated = true;
    state.textChars += clipped.length;
    state.nodes += 1;
    return [clipped];
  }
  if (DROPPED.has(node.name)) return [];
  if (depth > state.limits.maxDepth || state.nodes > state.limits.maxNodes) {
    state.truncated = true;
    return [];
  }
  const children = (): SafeNode[] => {
    const out: SafeNode[] = [];
    for (const child of node.children) out.push(...walk(child, state, depth + 1));
    return out;
  };
  const tag = TAG_MAP[node.name];
  if (!tag) {
    // Unknown, table and inline wrapper elements keep their text; cells are separated by a space.
    const inner = children();
    return node.name === 'td' || node.name === 'th' ? [...inner, ' '] : inner;
  }
  state.nodes += 1;
  if (tag === 'br') return [{ tag: 'br' }];
  if (tag === 'img') {
    const src = safeImageUrl(node.attrs['src'], state.baseUrl);
    if (!src) return [];
    const alt = collapse(node.attrs['alt'] ?? '')
      .trim()
      .slice(0, 300);
    return [{ tag: 'img', src, ...(alt ? { alt } : {}) }];
  }
  if (tag === 'a') {
    const href = safeLinkUrl(node.attrs['href'], state.baseUrl);
    const inner = children();
    return href ? [{ tag: 'a', href, children: inner }] : inner;
  }
  return [{ tag, children: children() }];
}

function trimTree(nodes: readonly SafeNode[]): SafeNode[] {
  const out: SafeNode[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      const previous = out[out.length - 1];
      if (typeof previous === 'string') out[out.length - 1] = previous + node;
      else out.push(node);
    } else if (node.children) {
      out.push({ ...node, children: trimTree(node.children) });
    } else {
      out.push(node);
    }
  }
  const first = out[0];
  if (typeof first === 'string') {
    const trimmed = first.trimStart();
    if (trimmed === '') out.shift();
    else out[0] = trimmed;
  }
  const last = out[out.length - 1];
  if (typeof last === 'string') {
    const trimmed = last.trimEnd();
    if (trimmed === '') out.pop();
    else out[out.length - 1] = trimmed;
  }
  return out;
}

/** True when the tree holds visible text or an image. */
export function hasSafeContent(nodes: readonly SafeNode[]): boolean {
  return nodes.some((node) => {
    if (typeof node === 'string') return node.trim() !== '';
    if (node.tag === 'img') return true;
    return node.children ? hasSafeContent(node.children) : false;
  });
}

/** An already parsed markup tree (the article extractor's cleaned subtree) to a safe tree. */
export function sanitizeMarkupNodes(
  nodes: readonly MarkupNode[],
  options: SanitizeOptions = {},
): SafeNode[] {
  const state: SanitizeState = {
    nodes: 0,
    textChars: 0,
    truncated: false,
    limits: options.limits ?? DEFAULT_SANITIZE_LIMITS,
    baseUrl: options.baseUrl,
  };
  const out: SafeNode[] = [];
  for (const node of nodes) out.push(...walk(node, state, 0));
  return trimTree(out);
}

/** Feed `html` (or text that merely looks like it) to a safe tree. */
export function sanitizeFeedHtml(html: string, options: SanitizeOptions = {}): SafeNode[] {
  const limits = options.limits ?? DEFAULT_SANITIZE_LIMITS;
  // Raw input is clipped before parsing so a hostile item cannot make the tokenizer do unbounded work.
  const root = parseMarkup(html.slice(0, limits.maxTextChars * 4), 'html');
  return sanitizeMarkupNodes(root.children, options);
}

function collectPlain(node: MarkupNode, parts: string[]): void {
  if (node.kind === 'text') {
    parts.push(node.text);
    return;
  }
  if (DROPPED.has(node.name)) return;
  const block = BLOCK_TAGS.has(node.name);
  if (block) parts.push(' ');
  for (const child of node.children) collectPlain(child, parts);
  if (block) parts.push(' ');
}

/** Visible plain text of an HTML fragment (titles, snippets): entities decoded, no markup, one line. */
export function plainTextFromHtml(html: string, maxChars = 100_000): string {
  if (!html.includes('<') && !html.includes('&')) return collapse(html).trim();
  const root: MarkupElement = parseMarkup(html.slice(0, maxChars * 2), 'html');
  const parts: string[] = [];
  for (const child of root.children) collectPlain(child, parts);
  return collapse(parts.join('')).trim();
}

/** A one-line snippet cut at a word boundary. */
export function snippetFrom(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The first image of a tree, when any: used as a thumbnail fallback. */
export function firstImageOf(nodes: readonly SafeNode[]): string | undefined {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    if (node.tag === 'img') return node.src;
    if (node.children) {
      const nested = firstImageOf(node.children);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** The tree without images (rendered when a subscription has images switched off). */
export function withoutImages(nodes: readonly SafeNode[]): SafeNode[] {
  const out: SafeNode[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') out.push(node);
    else if (node.tag === 'img') continue;
    else if (node.children) out.push({ ...node, children: withoutImages(node.children) });
    else out.push(node);
  }
  return out;
}

/** Characters of visible text in a tree: tells a full article from a one-line teaser. */
export function safeTextLength(nodes: readonly SafeNode[]): number {
  let length = 0;
  for (const node of nodes) {
    if (typeof node === 'string') length += node.trim().length;
    else if (node.children) length += safeTextLength(node.children);
  }
  return length;
}
