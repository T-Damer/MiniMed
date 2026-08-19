import { For, type JSX, Show } from 'solid-js';

export interface MarkdownOutlineItem {
  readonly anchor: string;
  readonly label: string;
  readonly depth: number;
}

type MarkdownBlock =
  | { readonly kind: 'heading'; readonly depth: number; readonly text: string; readonly anchor: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'blockquote'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'math'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }
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
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
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
  if (href.startsWith('#/')) return href;
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

function safeImageSrc(value: string): string | null {
  const src = value.trim();
  if (!src) return null;
  if (src.startsWith('blob:') || /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/iu.test(src)) {
    return src;
  }
  try {
    const url = new URL(src, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return src;
  } catch {
    return null;
  }
  return null;
}

interface InlineToken {
  readonly kind: 'text' | 'strong' | 'em' | 'code' | 'math' | 'link' | 'image';
  readonly text: string;
  readonly href?: string;
}

function tokenizeInline(value: string): readonly InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(!?\[([^\]]*)\]\(([^)]+)\)|`([^`]+)`|\$([^$\n]+)\$|\*\*([^*]+)\*\*|__([^_]+)__|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_))/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) tokens.push({ kind: 'text', text: value.slice(cursor, at) });
    const raw = match[0] ?? '';
    if (raw.startsWith('![')) {
      tokens.push({ kind: 'image', text: match[2] ?? '', href: match[3] ?? '' });
    } else if (raw.startsWith('[')) {
      tokens.push({ kind: 'link', text: match[2] ?? '', href: match[3] ?? '' });
    } else if (match[4] !== undefined) {
      tokens.push({ kind: 'code', text: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ kind: 'math', text: match[5] });
    } else if (match[6] !== undefined || match[7] !== undefined) {
      tokens.push({ kind: 'strong', text: match[6] ?? match[7] ?? '' });
    } else {
      tokens.push({ kind: 'em', text: match[8] ?? match[9] ?? '' });
    }
    cursor = at + raw.length;
  }
  if (cursor < value.length) tokens.push({ kind: 'text', text: value.slice(cursor) });
  return tokens;
}

function InlineMarkdown(props: { readonly text: string }): JSX.Element {
  return (
    <>
      <For each={tokenizeInline(props.text)}>
        {(token) => {
          if (token.kind === 'strong') return <strong>{token.text}</strong>;
          if (token.kind === 'em') return <em>{token.text}</em>;
          if (token.kind === 'code') return <code>{token.text}</code>;
          if (token.kind === 'math') {
            return (
              <span class="safe-markdown__math-inline" aria-label={`LaTeX: ${token.text}`}>
                {token.text}
              </span>
            );
          }
          if (token.kind === 'link') {
            const href = safeHref(token.href ?? '');
            return href ? (
              <a href={href} rel="noopener noreferrer">
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
    </>
  );
}

function Heading(props: Extract<MarkdownBlock, { kind: 'heading' }>): JSX.Element {
  const content = <InlineMarkdown text={props.text} />;
  if (props.depth === 1) return <h1 id={props.anchor} data-user-doc-anchor="">{content}</h1>;
  if (props.depth === 2) return <h2 id={props.anchor} data-user-doc-anchor="">{content}</h2>;
  if (props.depth === 3) return <h3 id={props.anchor} data-user-doc-anchor="">{content}</h3>;
  if (props.depth === 4) return <h4 id={props.anchor} data-user-doc-anchor="">{content}</h4>;
  if (props.depth === 5) return <h5 id={props.anchor} data-user-doc-anchor="">{content}</h5>;
  return <h6 id={props.anchor} data-user-doc-anchor="">{content}</h6>;
}

export function SafeMarkdown(props: { readonly markdown: string }): JSX.Element {
  const parsed = () => parseMarkdownDocument(props.markdown);
  return (
    <div class="safe-markdown">
      <For each={parsed().blocks}>
        {(block) => {
          if (block.kind === 'heading') return <Heading {...block} />;
          if (block.kind === 'hr') return <hr />;
          if (block.kind === 'code') {
            return (
              <pre class="safe-markdown__code" data-language={block.language || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          }
          if (block.kind === 'math') {
            return (
              <pre class="safe-markdown__math" aria-label="Блок LaTeX">
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
                <For each={block.items}>{(item) => <li><InlineMarkdown text={item} /></li>}</For>
              </ol>
            ) : (
              <ul>
                <For each={block.items}>{(item) => <li><InlineMarkdown text={item} /></li>}</For>
              </ul>
            );
          }
          if (block.kind === 'table') {
            return (
              <div class="safe-markdown__table-scroll">
                <table>
                  <thead>
                    <tr><For each={block.header}>{(cell) => <th><InlineMarkdown text={cell} /></th>}</For></tr>
                  </thead>
                  <tbody>
                    <For each={block.rows}>
                      {(row) => <tr><For each={row}>{(cell) => <td><InlineMarkdown text={cell} /></td>}</For></tr>}
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
