import { describe, expect, it } from 'vitest';

import {
  buildUserDocumentOutlineItems,
  buildUserDocumentPrintHtml,
  filterOutlineItems,
  findEpubOutlineAnchor,
  flattenEpubNavigation,
  pageAnchorId,
  textMatchesDocumentQuery,
} from '@/features/library/user-document-reader-helpers';

describe('user-document-reader-helpers', () => {
  it('builds visual page outline labels', () => {
    const items = buildUserDocumentOutlineItems('application/pdf', [
      {
        documentId: 'doc-1',
        pageIndex: 0,
        kind: 'native',
        text: 'Page one',
      },
      {
        documentId: 'doc-1',
        pageIndex: 1,
        kind: 'ocr',
        text: 'Page two',
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe('Страница 1');
    expect(items[0]?.anchor).toBe(pageAnchorId('doc-1', 0));
    expect(items[1]?.label).toBe('Страница 2');
  });

  it('builds visual page outline from page count when pages are still empty', () => {
    const items = buildUserDocumentOutlineItems('application/pdf', [], {
      documentId: 'doc-1',
      visualPageCount: 3,
    });
    expect(items).toHaveLength(3);
    expect(items[2]?.label).toBe('Страница 3');
    expect(items[2]?.anchor).toBe(pageAnchorId('doc-1', 2));
  });

  it('uses markdown headings for text-like documents when present', () => {
    const items = buildUserDocumentOutlineItems('text/markdown', [
      {
        documentId: 'doc-1',
        pageIndex: 0,
        kind: 'native',
        text: '# Введение\n\nТекст\n## Детали',
      },
    ]);
    expect(items.map((item) => item.label)).toEqual(['Введение', 'Детали']);
    expect(items[0]?.anchor).toBe(pageAnchorId('doc-1', 0));
    expect(items[0]?.depth).toBe(1);
    expect(items[1]?.depth).toBe(2);
  });

  it('falls back to part labels without headings', () => {
    const items = buildUserDocumentOutlineItems('text/plain', [
      {
        documentId: 'doc-1',
        pageIndex: 0,
        kind: 'native',
        text: 'Простой текст без заголовков.',
      },
    ]);
    expect(items[0]?.label).toBe('Часть 1');
  });

  it('keeps EPUB navigation labels, nesting, and chapter hrefs', () => {
    const items = flattenEpubNavigation([
      {
        href: 'text/part.xhtml',
        label: ' Часть первая ',
        subitems: [{ href: 'text/chapter.xhtml#one', label: 'Глава I' }],
      },
    ]);

    expect(items).toEqual([
      {
        anchor: 'text/part.xhtml',
        label: 'Часть первая',
        depth: 1,
        searchTexts: [' Часть первая '],
      },
      {
        anchor: 'text/chapter.xhtml#one',
        label: 'Глава I',
        depth: 2,
        searchTexts: ['Глава I'],
      },
    ]);
    expect(findEpubOutlineAnchor(items, 'text/chapter.xhtml')).toBe('text/chapter.xhtml#one');
  });

  it('filters outline items with fuzzy query', () => {
    const items = buildUserDocumentOutlineItems('application/pdf', [
      {
        documentId: 'doc-1',
        pageIndex: 0,
        kind: 'native',
        text: 'Гипертония',
      },
      {
        documentId: 'doc-1',
        pageIndex: 1,
        kind: 'native',
        text: 'Диабет',
      },
    ]);
    const filtered = filterOutlineItems(items, 'гиперт');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.label).toBe('Страница 1');
  });

  it('escapes print html and includes page text', () => {
    const html = buildUserDocumentPrintHtml('Книга <test>', [
      {
        documentId: 'doc-1',
        pageIndex: 0,
        kind: 'native',
        text: 'Строка & текст',
      },
    ]);
    expect(html).toContain('Книга &lt;test&gt;');
    expect(html).toContain('Строка &amp; текст');
    expect(html).not.toContain('<test>');
  });

  it('uses small A4 margins and keeps explicit text pages separate for a template', () => {
    const html = buildUserDocumentPrintHtml(
      'Осмотр на дому',
      [
        { documentId: 'doc-1', pageIndex: 0, kind: 'native', text: 'Первая страница' },
        { documentId: 'doc-1', pageIndex: 1, kind: 'native', text: 'Вторая страница' },
      ],
      true,
    );
    expect(html).toContain('@page { size: A4; margin: 10mm; }');
    expect(html).toContain('break-after: page');
  });

  it('matches document query exactly by default', () => {
    expect(textMatchesDocumentQuery('Гипертоническая болезнь', 'диабет')).toBe(false);
    expect(textMatchesDocumentQuery('Гипертоническая болезнь', 'болезнь')).toBe(true);
    expect(textMatchesDocumentQuery('Диабет', 'гиперт')).toBe(false);
  });

  it('matches document query with similar words when enabled', () => {
    expect(textMatchesDocumentQuery('Гипертоническая болезнь', 'гиперт', true)).toBe(true);
    expect(textMatchesDocumentQuery('Диабет', 'гиперт', true)).toBe(false);
  });
});
