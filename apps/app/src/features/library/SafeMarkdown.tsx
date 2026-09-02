import { createEffect, type JSX, onCleanup, onMount } from 'solid-js';

import {
  type ParsedMarkdownDocument,
  parseMarkdownDocument,
} from '@/features/library/markdown-parser';
import { renderMarkdownHtml, sanitizeMarkdownHtml } from '@/features/library/markdown-renderer';

export {
  MARKDOWN_WORKER_THRESHOLD,
  type MarkdownOutlineItem,
  type ParsedMarkdownDocument,
  parseMarkdownDocument,
  parseMarkdownDocumentAsync,
} from '@/features/library/markdown-parser';

function scrollToMarkdownAnchor(rawHref: string): void {
  const id = decodeURIComponent(rawHref.slice(1));
  const target =
    document.getElementById(id) ??
    document.getElementById(`md-${id}`) ??
    Array.from(document.querySelectorAll<HTMLElement>('[data-user-doc-anchor]')).find(
      (heading) => heading.id === id,
    );
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function SafeMarkdown(props: {
  readonly markdown: string;
  readonly class?: string;
  readonly parsed?: ParsedMarkdownDocument;
}): JSX.Element {
  let host: HTMLDivElement | undefined;
  let cachedMarkdown = '';
  let cachedParsed: ParsedMarkdownDocument | undefined;
  let cachedHtml = '';
  let hasCachedHtml = false;

  const renderedHtml = (): string => {
    if (hasCachedHtml && cachedMarkdown === props.markdown && cachedParsed === props.parsed) {
      return cachedHtml;
    }
    const parsed = props.parsed ?? parseMarkdownDocument(props.markdown);
    cachedMarkdown = props.markdown;
    cachedParsed = props.parsed;
    cachedHtml = sanitizeMarkdownHtml(
      renderMarkdownHtml(parsed, props.markdown.length >= 64 * 1024),
    );
    hasCachedHtml = true;
    return cachedHtml;
  };

  const updateHtml = (): void => {
    if (host) host.innerHTML = renderedHtml();
  };

  createEffect(updateHtml);

  onMount(() => {
    const element = host;
    if (!element) return;
    const handleClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
      const href = link?.getAttribute('href') ?? '';
      if (!link || !href || href.startsWith('#/')) return;
      event.preventDefault();
      scrollToMarkdownAnchor(href);
    };
    element.addEventListener('click', handleClick);
    onCleanup(() => element.removeEventListener('click', handleClick));
  });

  return (
    <div
      ref={(element) => {
        host = element;
        updateHtml();
      }}
      class={`safe-markdown${props.class ? ` ${props.class}` : ''}`}
    />
  );
}
