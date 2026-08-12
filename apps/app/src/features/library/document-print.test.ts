import type { MedicalDocument } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { printDocument, shareDocument } from '@/features/library/document-print';

function buildDocument(): MedicalDocument {
  return {
    id: 'reference.pevzner.diet-table-5',
    title: 'Лечебная диета — стол №5',
    shortTitle: 'Стол №5',
    sourceType: 'medical_reference',
    status: 'active',
    specialties: ['gastroenterology'],
    metadata: {},
    versionId: 'reference.pevzner.diet-table-5@v1',
    versionLabel: 'web-secondary-reviewed-2026-08-11',
    effectiveFrom: null,
    sections: [
      {
        id: 'section-1',
        documentVersionId: 'reference.pevzner.diet-table-5@v1',
        parentSectionId: null,
        title: 'Разрешённые продукты',
        sectionType: null,
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'разрешенные-продукты',
        sectionPath: ['Разрешённые продукты'],
        chunks: [
          {
            id: 'chunk-1',
            sectionId: 'section-1',
            documentVersionId: 'reference.pevzner.diet-table-5@v1',
            orderIndex: 0,
            originalText: '- нежирное мясо и рыба;\n- нежирные молочные продукты.',
            pageStart: null,
            pageEnd: null,
            anchor: 'chunk-1',
          },
          {
            id: 'chunk-2',
            sectionId: 'section-1',
            documentVersionId: 'reference.pevzner.diet-table-5@v1',
            orderIndex: 1,
            originalText: '',
            pageStart: null,
            pageEnd: null,
            anchor: 'chunk-2',
            metadata: {
              renderBlock: {
                kind: 'table',
                caption: 'Пример',
                rows: [
                  {
                    cells: [
                      { text: 'Заголовок', header: true, rowSpan: 1, colSpan: 1, images: [] },
                      { text: 'Значение', header: false, rowSpan: 1, colSpan: 1, images: [] },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

describe('document print layout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders headings, real lists, and real tables into the popup markup', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, opener: undefined, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/#/knowledge/reference/diet-table-5' },
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(printDocument(buildDocument())).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0] as string;
    expect(markup).toContain('<h2>Разрешённые продукты</h2>');
    expect(markup).toContain('<ul class="doc-print__list"><li>нежирное мясо и рыба;</li>');
    expect(markup).toContain('<table class="doc-print__table">');
    expect(markup).toContain('<th>Заголовок</th>');
    expect(markup).toContain('<td>Значение</td>');
    expect(markup).toContain('class="doc-print__footer-qr"');
    expect(markup).toContain('href="http://127.0.0.1:5175/#/knowledge/reference/diet-table-5"');
  });

  it('returns false without throwing when the print popup is blocked', () => {
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/' },
      open: vi.fn(() => null),
    });
    expect(printDocument(buildDocument())).toBe(false);
  });

  it('shares a title/summary/link and falls back to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:5175/' } });

    await expect(shareDocument(buildDocument())).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledOnce();
    const [sharedText] = writeText.mock.calls[0] as [string];
    expect(sharedText).toContain('Лечебная диета — стол №5');
    expect(sharedText).toContain('http://127.0.0.1:5175/');
  });
});
