import { For, type JSX, Show } from 'solid-js';

export interface MarkdownOutlineItem {
  readonly anchor: string;
  readonly label: string;
  readonly depth: number;
}

type MarkdownBlock =
  | {
      readonly kind: 'heading';
      readonly depth: number;
      readonly text: string;
      readonly anchor: string;
    }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'blockquote'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'math'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | {
      readonly kind: 'table';
      readonly header: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: 'html'; readonly html: string }
  | { readonly kind: 'hr' };

export interface ParsedMarkdownDocument {
  readonly blocks: readonly MarkdownBlock[];
  readonly outline: readonly MarkdownOutlineItem[];
}

function slugBase(value: string): string {
  const slug = value
    .toLocaleLowerCase('ru-RU')
    .trim()
    .replace(/[`*_~[\]{}()<>]/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'section';
}

function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugBase(text);
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? `md-${base}` : `md-${base}-${String(count)}`;
}

function splitTableRow(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.replace(/\\\|/gu, '|').trim());
}

function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, '')));
}

function flushParagraph(lines: string[], blocks: MarkdownBlock[]): void {
  if (lines.length === 0) return;
  const text = lines.join('\n').trim();
  lines.length = 0;
  if (text) blocks.push({ kind: 'paragraph', text });
}

export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const outline: MarkdownOutlineItem[] = [];
  const paragraph: string[] = [];
  const seenSlugs = new Map<string, number>();

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    const fence = /^\s*```([^`]*)$/u.exec(line);
    if (fence) {
      flushParagraph(paragraph, blocks);
      const language = (fence[1] ?? '').trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'code', language, text: code.join('\n') });
      index += 1;
      continue;
    }

    if (/^\s*\$\$\s*$/u.test(line)) {
      flushParagraph(paragraph, blocks);
      const math: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/u.test(lines[index] ?? '')) {
        math.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'math', text: math.join('\n').trim() });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      flushParagraph(paragraph, blocks);
      const depth = heading[1]?.length ?? 1;
      const text = (heading[2] ?? '').trim();
      const anchor = uniqueSlug(text, seenSlugs);
      blocks.push({ kind: 'heading', depth, text, anchor });
      outline.push({ anchor, label: text, depth });
      index += 1;
      continue;
    }

    const htmlBlock =
      /^\s*<(details|div|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|section|aside|dl|dt|dd|ul|ol|li|h[1-6]|p|hr)\b/iu.exec(
        line,
      );
    if (htmlBlock) {
      flushParagraph(paragraph, blocks);
      const tag = htmlBlock[1] ?? '';
      const htmlLines = [line];
      index += 1;
      if (!/^\s*<hr\b[^>]*\/?>\s*$/iu.test(line) && !new RegExp(`</${tag}\\s*>`, 'iu').test(line)) {
        while (index < lines.length) {
          htmlLines.push(lines[index] ?? '');
          index += 1;
          if (new RegExp(`</${tag}\\s*>`, 'iu').test(htmlLines.join('\n'))) break;
        }
      }
      blocks.push({ kind: 'html', html: htmlLines.join('\n') });
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      flushParagraph(paragraph, blocks);
      blocks.push({ kind: 'hr' });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1] ?? '')) {
      flushParagraph(paragraph, blocks);
      const header = splitTableRow(line);
      const rows: (readonly string[])[] = [];
      index += 2;
      while (
        index < lines.length &&
        (lines[index] ?? '').includes('|') &&
        (lines[index] ?? '').trim()
      ) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const unordered = /^\s*[-+*]\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      flushParagraph(paragraph, blocks);
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = lines[index] ?? '';
        const match = isOrdered
          ? /^\s*\d+[.)]\s+(.+)$/u.exec(itemLine)
          : /^\s*[-+*]\s+(.+)$/u.exec(itemLine);
        if (!match) break;
        items.push((match[1] ?? '').trim());
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    if (/^\s*>/u.test(line)) {
      flushParagraph(paragraph, blocks);
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/u.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/u, ''));
        index += 1;
      }
      blocks.push({ kind: 'blockquote', text: quote.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph(paragraph, blocks);
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph(paragraph, blocks);
  return { blocks, outline };
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return href;
    }
  } catch {
    return null;
  }
  return null;
}

const ALLOWED_HTML_TAGS = new Set([
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
  'ins',
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
]);

const FORBIDDEN_HTML_TAGS = new Set([
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'style',
  'textarea',
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function safeHtmlAttribute(name: string, value: string): string | null {
  const normalized = name.toLocaleLowerCase('en-US');
  if (normalized.startsWith('on') || normalized === 'style' || normalized === 'srcdoc') return null;
  if (normalized === 'href') return safeHref(value);
  if (normalized === 'src') return safeImageSrc(value);
  if (normalized === 'target') return value === '_blank' ? value : null;
  if (normalized === 'rel') return value;
  if (normalized === 'class') {
    return (
      value
        .split(/\s+/u)
        .filter((namePart) => namePart.startsWith('safe-markdown__'))
        .join(' ') || null
    );
  }
  if (normalized === 'id') return /^[A-Za-z][\w:.-]*$/u.test(value) ? value : null;
  if (
    normalized === 'alt' ||
    normalized === 'align' ||
    normalized === 'aria-hidden' ||
    normalized === 'aria-label' ||
    normalized === 'colspan' ||
    normalized === 'height' ||
    normalized === 'open' ||
    normalized === 'reversed' ||
    normalized === 'rowspan' ||
    normalized === 'start' ||
    normalized === 'title' ||
    normalized === 'type' ||
    normalized === 'width'
  ) {
    return value;
  }
  return null;
}

function appendSanitizedHtmlNode(node: ChildNode, parent: DocumentFragment | HTMLElement): void {
  if (node.nodeType === 3) {
    parent.append(document.createTextNode(node.textContent ?? ''));
    return;
  }
  if (node.nodeType !== 1) return;
  const source = node as HTMLElement;
  const tag = source.tagName.toLocaleLowerCase('en-US');
  if (FORBIDDEN_HTML_TAGS.has(tag)) return;
  if (!ALLOWED_HTML_TAGS.has(tag)) {
    for (const child of Array.from(source.childNodes)) appendSanitizedHtmlNode(child, parent);
    return;
  }
  const clean = document.createElement(tag);
  for (const attribute of Array.from(source.attributes)) {
    const value = safeHtmlAttribute(attribute.name, attribute.value);
    if (value !== null) clean.setAttribute(attribute.name.toLocaleLowerCase('en-US'), value);
  }
  for (const child of Array.from(source.childNodes)) appendSanitizedHtmlNode(child, clean);
  parent.append(clean);
}

function sanitizeHtmlFragment(raw: string): string {
  const template = document.createElement('template');
  template.innerHTML = raw;
  const output = document.createDocumentFragment();
  for (const child of Array.from(template.content.childNodes)) {
    appendSanitizedHtmlNode(child, output);
  }
  const container = document.createElement('div');
  container.append(output);
  return container.innerHTML;
}

function safeImageSrc(value: string): string | null {
  const src = value.trim();
  if (!src) return null;
  if (src.startsWith('blob:') || /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/iu.test(src)) {
    return src;
  }
  return null;
}

interface InlineToken {
  readonly kind: 'text' | 'html' | 'strong' | 'em' | 'code' | 'math' | 'link' | 'image';
  readonly text: string;
  readonly href?: string;
}

function tokenizeInline(value: string): readonly InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern =
    /(?:<\/?[A-Za-z][^<>]*>|!?\[([^\]]*)\]\(([^)]+)\)|`([^`]+)`|\$([^$\n]+)\$|\*\*([^*]+)\*\*|__([^_]+)__|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_))/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) tokens.push({ kind: 'text', text: value.slice(cursor, at) });
    const raw = match[0] ?? '';
    if (raw.startsWith('<')) {
      tokens.push({ kind: 'html', text: raw });
    } else if (raw.startsWith('![')) {
      tokens.push({ kind: 'image', text: match[1] ?? '', href: match[2] ?? '' });
    } else if (raw.startsWith('[')) {
      tokens.push({ kind: 'link', text: match[1] ?? '', href: match[2] ?? '' });
    } else if (match[3] !== undefined) {
      tokens.push({ kind: 'code', text: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ kind: 'math', text: match[4] });
    } else if (match[5] !== undefined || match[6] !== undefined) {
      tokens.push({ kind: 'strong', text: match[5] ?? match[6] ?? '' });
    } else {
      tokens.push({ kind: 'em', text: match[7] ?? match[8] ?? '' });
    }
    cursor = at + raw.length;
  }
  if (cursor < value.length) tokens.push({ kind: 'text', text: value.slice(cursor) });
  return tokens;
}

function inlineTokensToHtml(tokens: readonly InlineToken[]): string {
  const html = tokens
    .map((token) => {
      if (token.kind === 'html') return token.text;
      if (token.kind === 'text') return escapeHtml(token.text);
      if (token.kind === 'strong') return `<strong>${escapeHtml(token.text)}</strong>`;
      if (token.kind === 'em') return `<em>${escapeHtml(token.text)}</em>`;
      if (token.kind === 'code') return `<code>${escapeHtml(token.text)}</code>`;
      if (token.kind === 'math') {
        return `<span class="safe-markdown__math-inline" role="math" aria-label="${escapeHtml(`LaTeX: ${token.text}`)}">${escapeHtml(token.text)}</span>`;
      }
      if (token.kind === 'link') {
        const href = safeHref(token.href ?? '');
        if (!href) return escapeHtml(token.text);
        const target = href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${escapeHtml(href)}"${target}>${escapeHtml(token.text)}</a>`;
      }
      const src = safeImageSrc(token.href ?? '');
      if (!src) return escapeHtml(token.text);
      const caption = token.text ? `<figcaption>${escapeHtml(token.text)}</figcaption>` : '';
      return `<figure class="safe-markdown__inline-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}" loading="lazy">${caption}</figure>`;
    })
    .join('');
  return sanitizeHtmlFragment(html);
}

function InlineMarkdown(props: { readonly text: string }): JSX.Element {
  const tokens = () => tokenizeInline(props.text);
  return (
    <Show
      when={!tokens().some((token) => token.kind === 'html')}
      fallback={
        <span class="safe-markdown__html-inline" innerHTML={inlineTokensToHtml(tokens())} />
      }
    >
      <For each={tokens()}>
        {(token) => {
          if (token.kind === 'strong') return <strong>{token.text}</strong>;
          if (token.kind === 'em') return <em>{token.text}</em>;
          if (token.kind === 'code') return <code>{token.text}</code>;
          if (token.kind === 'math') {
            return (
              <span
                class="safe-markdown__math-inline"
                role="math"
                aria-label={`LaTeX: ${token.text}`}
              >
                {token.text}
              </span>
            );
          }
          if (token.kind === 'link') {
            const raw = token.href ?? '';
            if (raw.startsWith('#') && !raw.startsWith('#/')) {
              // Inner-document anchor: scroll to the heading instead of navigating.
              return (
                <a
                  href={raw}
                  onClick={(event) => {
                    event.preventDefault();
                    const id = decodeURIComponent(raw.slice(1));
                    const target =
                      document.getElementById(id) ??
                      document.getElementById(`md-${id}`) ??
                      Array.from(
                        document.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]'),
                      ).find((heading) => slugBase(heading.textContent ?? '') === slugBase(id));
                    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {token.text}
                </a>
              );
            }
            const href = safeHref(raw);
            return href ? (
              <a
                href={href}
                target={href.startsWith('#/') ? undefined : '_blank'}
                rel="noopener noreferrer"
              >
                {token.text}
              </a>
            ) : (
              <span>{token.text}</span>
            );
          }
          if (token.kind === 'image') {
            const src = safeImageSrc(token.href ?? '');
            return src ? (
              <figure class="safe-markdown__inline-image">
                <img src={src} alt={token.text} loading="lazy" />
                <Show when={token.text}>
                  <figcaption>{token.text}</figcaption>
                </Show>
              </figure>
            ) : (
              <span>{token.text}</span>
            );
          }
          return <>{token.text}</>;
        }}
      </For>
    </Show>
  );
}

function Heading(props: Extract<MarkdownBlock, { kind: 'heading' }>): JSX.Element {
  const content = <InlineMarkdown text={props.text} />;
  if (props.depth === 1)
    return (
      <h1 id={props.anchor} data-user-doc-anchor="">
        {content}
      </h1>
    );
  if (props.depth === 2)
    return (
      <h2 id={props.anchor} data-user-doc-anchor="">
        {content}
      </h2>
    );
  if (props.depth === 3)
    return (
      <h3 id={props.anchor} data-user-doc-anchor="">
        {content}
      </h3>
    );
  if (props.depth === 4)
    return (
      <h4 id={props.anchor} data-user-doc-anchor="">
        {content}
      </h4>
    );
  if (props.depth === 5)
    return (
      <h5 id={props.anchor} data-user-doc-anchor="">
        {content}
      </h5>
    );
  return (
    <h6 id={props.anchor} data-user-doc-anchor="">
      {content}
    </h6>
  );
}

export function SafeMarkdown(props: {
  readonly markdown: string;
  readonly class?: string;
}): JSX.Element {
  const parsed = () => parseMarkdownDocument(props.markdown);
  return (
    <div class={`safe-markdown${props.class ? ` ${props.class}` : ''}`}>
      <For each={parsed().blocks}>
        {(block) => {
          if (block.kind === 'heading') return <Heading {...block} />;
          if (block.kind === 'hr') return <hr />;
          if (block.kind === 'html') {
            return <div class="safe-markdown__html" innerHTML={sanitizeHtmlFragment(block.html)} />;
          }
          if (block.kind === 'code') {
            return (
              <pre class="safe-markdown__code" data-language={block.language || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          }
          if (block.kind === 'math') {
            return (
              <pre class="safe-markdown__math" role="math" aria-label="Блок LaTeX">
                {block.text}
              </pre>
            );
          }
          if (block.kind === 'blockquote') {
            return (
              <blockquote>
                <InlineMarkdown text={block.text} />
              </blockquote>
            );
          }
          if (block.kind === 'list') {
            return block.ordered ? (
              <ol>
                <For each={block.items}>
                  {(item) => (
                    <li>
                      <InlineMarkdown text={item} />
                    </li>
                  )}
                </For>
              </ol>
            ) : (
              <ul>
                <For each={block.items}>
                  {(item) => (
                    <li>
                      <InlineMarkdown text={item} />
                    </li>
                  )}
                </For>
              </ul>
            );
          }
          if (block.kind === 'table') {
            return (
              <div class="safe-markdown__table-scroll">
                <table>
                  <thead>
                    <tr>
                      <For each={block.header}>
                        {(cell) => (
                          <th>
                            <InlineMarkdown text={cell} />
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={block.rows}>
                      {(row) => (
                        <tr>
                          <For each={row}>
                            {(cell) => (
                              <td>
                                <InlineMarkdown text={cell} />
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            );
          }
          return (
            <p>
              <InlineMarkdown text={block.text} />
            </p>
          );
        }}
      </For>
    </div>
  );
}
