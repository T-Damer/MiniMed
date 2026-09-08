import type { Root, RootContent } from 'mdast';
import { pandocMarkFromMarkdown } from 'mdast-util-mark';
import { pandocMark } from 'micromark-extension-mark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { type Processor, unified } from 'unified';

export interface MarkdownOutlineItem {
  readonly anchor: string;
  readonly label: string;
  readonly depth: number;
}

export interface ParsedMarkdownDocument {
  readonly tree: Root;
  readonly blocks: readonly RootContent[];
  readonly outline: readonly MarkdownOutlineItem[];
}

export const MARKDOWN_WORKER_THRESHOLD = 64 * 1024;

function remarkMarkExtension(this: Processor): void {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
  };
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), pandocMark()];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), pandocMarkFromMarkdown];
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkMarkExtension);

export function markdownNodeText(node: Root | RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) {
    return node.children.map((child) => markdownNodeText(child)).join('');
  }
  return '';
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

export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
  const tree = markdownProcessor.parse(markdown);
  const outline: MarkdownOutlineItem[] = [];
  const seenSlugs = new Map<string, number>();

  for (const block of tree.children) {
    if (block.type !== 'heading') continue;
    const label = markdownNodeText(block).trim();
    const anchor = uniqueSlug(label, seenSlugs);
    block.data = {
      ...block.data,
      hProperties: {
        ...block.data?.hProperties,
        id: anchor,
        'data-user-doc-anchor': '',
      },
    };
    outline.push({ anchor, label, depth: block.depth });
  }

  return { tree, blocks: tree.children, outline };
}

interface MarkdownWorkerRequest {
  readonly requestId: number;
  readonly markdown: string;
}

interface MarkdownWorkerResponse {
  readonly requestId: number;
  readonly document?: ParsedMarkdownDocument;
  readonly error?: string;
}

interface PendingParse {
  readonly resolve: (document: ParsedMarkdownDocument) => void;
  readonly reject: (error: Error) => void;
}

let markdownWorker: Worker | undefined;
let nextWorkerRequestId = 0;
const pendingParses = new Map<number, PendingParse>();

function resetMarkdownWorker(error: Error): void {
  markdownWorker?.terminate();
  markdownWorker = undefined;
  for (const pending of pendingParses.values()) pending.reject(error);
  pendingParses.clear();
}

function getMarkdownWorker(): Worker {
  if (markdownWorker) return markdownWorker;
  const worker = new Worker(new URL('./markdown-parser.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    const response = event.data;
    const pending = pendingParses.get(response.requestId);
    if (!pending) return;
    pendingParses.delete(response.requestId);
    if (response.document) {
      pending.resolve(response.document);
    } else {
      pending.reject(new Error(response.error ?? 'Не удалось разобрать Markdown.'));
    }
  };
  worker.onerror = () => resetMarkdownWorker(new Error('Markdown worker завершился с ошибкой.'));
  markdownWorker = worker;
  return worker;
}

export function parseMarkdownDocumentAsync(markdown: string): Promise<ParsedMarkdownDocument> {
  if (markdown.length < MARKDOWN_WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return Promise.resolve(parseMarkdownDocument(markdown));
  }

  const requestId = nextWorkerRequestId++;
  return new Promise((resolve, reject) => {
    pendingParses.set(requestId, { resolve, reject });
    getMarkdownWorker().postMessage({ requestId, markdown } satisfies MarkdownWorkerRequest);
  });
}
