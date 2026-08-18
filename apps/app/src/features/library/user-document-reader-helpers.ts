import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  isUserLibraryTextLikeMime,
  isUserLibraryVisualMime,
  type UserLibraryPage,
} from '@/state/user-library';

export function pageAnchorId(documentId: string, pageIndex: number): string {
  return `user-doc-anchor-${documentId}-${String(pageIndex)}`;
}

export function pageCanvasId(documentId: string, pageIndex: number): string {
  return `user-doc-page-${documentId}-${String(pageIndex)}`;
}

export interface UserDocumentOutlineItem {
  readonly anchor: string;
  readonly label: string;
  readonly depth: number;
  readonly searchTexts: readonly string[];
}

function markdownOutlineItems(pageText: string, pageAnchor: string): UserDocumentOutlineItem[] {
  const items: UserDocumentOutlineItem[] = [];
  for (const line of pageText.split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
    if (!match) continue;
    const title = match[2]?.trim() ?? '';
    if (!title) continue;
    items.push({
      anchor: pageAnchor,
      label: title,
      depth: match[1]?.length ?? 1,
      searchTexts: [title, pageText],
    });
  }
  return items;
}

export function buildUserDocumentOutlineItems(
  mimeType: string,
  pages: readonly UserLibraryPage[],
  options?: { readonly documentId?: string; readonly visualPageCount?: number },
): readonly UserDocumentOutlineItem[] {
  if (isUserLibraryVisualMime(mimeType)) {
    const documentId = options?.documentId ?? pages[0]?.documentId ?? '';
    const count = Math.max(options?.visualPageCount ?? 0, pages.length);
    if (!documentId || count === 0) return [];
    return Array.from({ length: count }, (_, pageIndex) => {
      const page = pages.find((item) => item.pageIndex === pageIndex);
      const label = `Страница ${pageIndex + 1}`;
      return {
        anchor: pageAnchorId(documentId, pageIndex),
        label,
        depth: 1,
        searchTexts: [page?.text ?? '', label],
      };
    });
  }

  const items: UserDocumentOutlineItem[] = [];
  for (const page of pages) {
    const anchor = pageAnchorId(page.documentId, page.pageIndex);
    const headings = isUserLibraryTextLikeMime(mimeType)
      ? markdownOutlineItems(page.text, anchor)
      : [];
    if (headings.length > 0) {
      items.push(...headings);
      continue;
    }
    items.push({
      anchor,
      label: `Часть ${page.pageIndex + 1}`,
      depth: 1,
      searchTexts: [page.text, `Часть ${page.pageIndex + 1}`],
    });
  }
  return items;
}

export function filterOutlineItems(
  items: readonly UserDocumentOutlineItem[],
  query: string,
): readonly UserDocumentOutlineItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;
  return items.filter((item) => matchesFuzzyQuery(trimmed, item.searchTexts));
}

export function escapePrintHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildUserDocumentPrintHtml(
  title: string,
  pages: readonly UserLibraryPage[],
): string {
  const sections = pages
    .map((page) => {
      const text = page.text.trim();
      if (!text) return '';
      return `<section class="user-doc-print__section"><h2>${escapePrintHtml(
        `Страница ${page.pageIndex + 1}`,
      )}</h2><pre class="user-doc-print__text">${escapePrintHtml(text)}</pre></section>`;
    })
    .join('');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapePrintHtml(title)}</title>
  <style>
    body { font-family: sans-serif; margin: 1rem; }
    pre { white-space: pre-wrap; word-break: break-word; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>${escapePrintHtml(title)}</h1>
  ${sections}
</body>
</html>`;
}

export function textMatchesDocumentQuery(text: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  return matchesFuzzyQuery(trimmed, [text]);
}
