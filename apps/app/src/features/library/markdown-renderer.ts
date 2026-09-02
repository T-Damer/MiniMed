import DOMPurify from 'dompurify';
import { toHtml } from 'hast-util-to-html';
import { type Handler, toHast } from 'mdast-util-to-hast';
import { visit } from 'unist-util-visit';

import type { ParsedMarkdownDocument } from '@/features/library/markdown-parser';

type RenderedHastRoot = Extract<ReturnType<typeof toHast>, { type: 'root' }>;
type RenderedHastElement = Extract<RenderedHastRoot['children'][number], { type: 'element' }>;
type ToHastOptions = NonNullable<Parameters<typeof toHast>[1]>;

function classNames(node: RenderedHastElement): string[] {
  const value = node.properties.className;
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function addClass(node: RenderedHastElement, className: string): void {
  const names = classNames(node);
  if (!names.includes(className)) names.push(className);
  node.properties.className = names;
}

function hasClass(node: RenderedHastElement, className: string): boolean {
  return classNames(node).includes(className);
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;
  try {
    const url = new URL(href, 'https://localmed.invalid/');
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return href;
    }
  } catch {
    return null;
  }
  return null;
}

function safeImageSrc(value: string): string | null {
  const src = value.trim();
  if (!src) return null;
  if (src.startsWith('blob:') || /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/iu.test(src)) {
    return src;
  }
  return null;
}

function setMathProperties(node: RenderedHastElement, className: string, label: string): void {
  addClass(node, className);
  node.properties.role = 'math';
  node.properties.ariaLabel = label;
}

const markHandler: Handler = (state, node) => ({
  type: 'element',
  tagName: 'mark',
  properties: { className: ['safe-markdown__mark'] },
  children: state.all(node),
});

function decorateHast(tree: RenderedHastRoot, lazyBlocks: boolean): void {
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName === 'a') {
      const href = typeof node.properties.href === 'string' ? safeHref(node.properties.href) : null;
      if (!href) {
        delete node.properties.href;
      } else if (href.startsWith('#')) {
        delete node.properties.target;
        delete node.properties.rel;
      } else {
        node.properties.target = '_blank';
        node.properties.rel = ['noopener', 'noreferrer'];
      }
    }

    if (node.tagName === 'img') {
      node.properties.loading = 'lazy';
      addClass(node, 'safe-markdown__image');
    }

    if (node.tagName === 'pre') {
      const mathCode = node.children.find(
        (child): child is RenderedHastElement =>
          child.type === 'element' && child.tagName === 'code' && hasClass(child, 'math-display'),
      );
      if (mathCode) {
        setMathProperties(node, 'safe-markdown__math', 'Блок LaTeX');
      } else {
        addClass(node, 'safe-markdown__code');
        const code = node.children.find(
          (child): child is RenderedHastElement =>
            child.type === 'element' && child.tagName === 'code',
        );
        if (code) {
          const language = classNames(code).find((name) => name.startsWith('language-'));
          if (language) node.properties['data-language'] = language.slice('language-'.length);
        }
      }
    }

    if (node.tagName === 'code' && hasClass(node, 'math-inline')) {
      node.tagName = 'span';
      setMathProperties(
        node,
        'safe-markdown__math-inline',
        `LaTeX: ${node.children
          .map((child) => (child.type === 'text' ? child.value : ''))
          .join('')}`,
      );
    }

    if (node.tagName === 'table' && parent && index !== undefined) {
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['safe-markdown__table-scroll'] },
        children: [node],
      };
    }
  });

  for (const child of tree.children) {
    if (child.type !== 'element') continue;
    addClass(child, 'safe-markdown__block');
    if (lazyBlocks) addClass(child, 'safe-markdown__block--lazy');
  }
}

export function renderMarkdownHtml(
  document: ParsedMarkdownDocument,
  lazyBlocks = document.blocks.length > 80,
): string {
  const hast = toHast(document.tree as unknown as Parameters<typeof toHast>[0], {
    allowDangerousHtml: true,
    clobberPrefix: 'md-',
    handlers: { mark: markHandler } as NonNullable<ToHastOptions['handlers']>,
    footnoteBackLabel: (referenceIndex, rereferenceIndex) =>
      rereferenceIndex > 1
        ? `Вернуться к ссылке ${String(referenceIndex)}-${String(rereferenceIndex)}`
        : `Вернуться к ссылке ${String(referenceIndex)}`,
    footnoteLabel: 'Сноски',
  });
  if (hast?.type !== 'root') return '';
  decorateHast(hast, lazyBlocks);
  return toHtml(hast, { allowDangerousHtml: true });
}

const SAFE_MARKDOWN_TAGS = [
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'dd',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'img',
  'input',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'hr',
] as const;

const SAFE_MARKDOWN_ATTRIBUTES = [
  'alt',
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'checked',
  'class',
  'colspan',
  'data-footnote-backref',
  'data-footnote-ref',
  'data-footnote-refs',
  'data-footnotes',
  'data-language',
  'data-user-doc-anchor',
  'disabled',
  'href',
  'id',
  'loading',
  'open',
  'rel',
  'reversed',
  'rowspan',
  'src',
  'start',
  'target',
  'title',
  'type',
] as const;

let purifierConfigured = false;

function sanitizeWithDomPurify(html: string): string {
  if (typeof window === 'undefined' || typeof DOMPurify.sanitize !== 'function') return html;
  if (!purifierConfigured) {
    DOMPurify.addHook('uponSanitizeAttribute', (_node, event) => {
      const attribute = event.attrName.toLocaleLowerCase('en-US');
      if (attribute === 'href' && !safeHref(event.attrValue)) event.keepAttr = false;
      if (attribute === 'src' && !safeImageSrc(event.attrValue)) event.keepAttr = false;
    });
    purifierConfigured = true;
  }
  return DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: false,
    ALLOWED_ATTR: [...SAFE_MARKDOWN_ATTRIBUTES],
    ALLOWED_TAGS: [...SAFE_MARKDOWN_TAGS],
  });
}

export function sanitizeMarkdownHtml(html: string): string {
  return sanitizeWithDomPurify(html);
}
