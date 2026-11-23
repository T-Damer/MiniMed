/**
 * Structured, bounded app/file context capture for «Спросить ИИ» and future retrieval-first CDSS.
 *
 * Captures provenance (document title, active section heading, route/source ref) and a bounded
 * surrounding text window from the currently open medical document or user file — never silently
 * reading encrypted patient vault records.
 */

export type AskAiContextKind = 'section' | 'document-chunk' | 'user-file' | 'retrieved-excerpt';

export interface AskAiContextBlock {
  readonly kind: AskAiContextKind;
  readonly title?: string | undefined;
  readonly section?: string | undefined;
  readonly sourceRef?: string | undefined;
  readonly text: string;
}

export interface CapturedReaderContext {
  readonly documentTitle?: string | undefined;
  readonly sectionTitle?: string | undefined;
  readonly sourceRef?: string | undefined;
  readonly contextBlocks: readonly AskAiContextBlock[];
}

const MAX_SURROUNDING_CHARS = 2400;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Extracts a bounded window centered around `excerpt` inside `fullText`. */
export function extractBoundedWindow(
  fullText: string,
  excerpt: string,
  maxChars = MAX_SURROUNDING_CHARS,
): string {
  const normalizedFull = collapseWhitespace(fullText);
  if (normalizedFull.length <= maxChars) return normalizedFull;
  const normalizedExcerpt = collapseWhitespace(excerpt);
  const idx = normalizedExcerpt ? normalizedFull.indexOf(normalizedExcerpt) : -1;
  if (idx < 0) return `${normalizedFull.slice(0, maxChars).trimEnd()}…`;
  const half = Math.floor((maxChars - normalizedExcerpt.length) / 2);
  const start = Math.max(0, idx - Math.max(0, half));
  const end = Math.min(normalizedFull.length, start + maxChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedFull.length ? '…' : '';
  return `${prefix}${normalizedFull.slice(start, end).trim()}${suffix}`;
}

function findNearestHeading(node: Node | null, boundary: HTMLElement | null): string | undefined {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (current && current !== boundary) {
    const section = current.closest<HTMLElement>('section, article, [data-section-id]');
    if (section && (!boundary || boundary.contains(section))) {
      const heading = section.querySelector<HTMLElement>('h2, h3, h4');
      const text = heading?.textContent ? collapseWhitespace(heading.textContent) : '';
      if (text) return text;
    }
    let prev = current.previousElementSibling;
    while (prev) {
      if (/^H[2-4]$/u.test(prev.tagName)) {
        const text = collapseWhitespace(prev.textContent ?? '');
        if (text) return text;
      }
      prev = prev.previousElementSibling;
    }
    current = current.parentElement;
  }
  return undefined;
}

/**
 * Captures the active document title, enclosing section heading, route provenance, and a bounded
 * surrounding text block from the current reader surface for grounded AI answers.
 */
export function captureActiveReaderContext(
  excerpt: string,
  options?: {
    readonly surface?: HTMLElement | undefined;
    readonly documentId?: string | undefined;
  },
): CapturedReaderContext {
  if (typeof document === 'undefined') return { contextBlocks: [] };
  const activeView = document.querySelector<HTMLElement>(
    '.app-view--document-read.active, .app-view.active',
  );
  const surface = options?.surface ?? activeView ?? undefined;
  const headingEl =
    activeView?.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('h1');
  const documentTitle = headingEl?.textContent
    ? collapseWhitespace(headingEl.textContent)
    : undefined;

  const selection = document.getSelection();
  const anchorNode =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).commonAncestorContainer : null;
  const sectionTitle = findNearestHeading(anchorNode, surface ?? null);

  const anchorEl =
    anchorNode instanceof HTMLElement ? anchorNode : (anchorNode?.parentElement ?? null);
  const container =
    anchorEl?.closest<HTMLElement>('section, article, [data-section-id], .document-page__body') ??
    surface;
  const rawText = container?.textContent ? collapseWhitespace(container.textContent) : '';
  const excerptNorm = collapseWhitespace(excerpt);
  const bounded = rawText ? extractBoundedWindow(rawText, excerptNorm) : '';
  const sourceRef =
    options?.documentId ?? (typeof window !== 'undefined' ? window.location.hash : undefined);

  const contextBlocks: AskAiContextBlock[] =
    bounded && bounded.length > excerptNorm.length + 20
      ? [
          {
            kind: sourceRef?.includes('/user') ? 'user-file' : 'section',
            ...(documentTitle ? { title: documentTitle } : {}),
            ...(sectionTitle ? { section: sectionTitle } : {}),
            ...(sourceRef ? { sourceRef } : {}),
            text: bounded,
          },
        ]
      : [];

  return {
    ...(documentTitle ? { documentTitle } : {}),
    ...(sectionTitle ? { sectionTitle } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    contextBlocks,
  };
}
