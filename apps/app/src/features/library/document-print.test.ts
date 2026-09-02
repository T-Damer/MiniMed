import type { MedicalDocument } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printDocument, shareDocument } from '@/features/library/document-print';
import { PrintManager } from '@/features/printing/print-manager';

const nativeMocks = vi.hoisted(() => ({
  isNative: false,
  shareFile: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => nativeMocks.isNative,
  },
  registerPlugin: () => ({
    shareFile: nativeMocks.shareFile,
    shareText: vi.fn(),
  }),
}));

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
  afterEach(() => {
    nativeMocks.isNative = false;
    nativeMocks.shareFile.mockClear();
    vi.unstubAllGlobals();
  });

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

  it('prints arbitrary HTML through the shared popup helper', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, opener: undefined, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(PrintManager.html('<html><body><p>Test</p></body></html>', 'Test page')).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0] as string;
    expect(markup).toContain('<p>Test</p>');
  });

  it('prints the original file through a hidden frame', () => {
    const handlers = new Map<string, () => void>();
    const frame = {
      style: {},
      title: '',
      src: '',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      contentWindow: { focus: vi.fn(), print: vi.fn() },
      remove: vi.fn(),
    } as unknown as HTMLIFrameElement;
    const createObjectURL = vi.fn(() => 'blob:original');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => frame),
      body: { append: vi.fn() },
    });
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    const printed = PrintManager.original(new Blob(['original']), 'Original EPUB');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(frame.src).toBe('blob:original');

    handlers.get('load')?.();
    return expect(printed)
      .resolves.toBe(true)
      .then(() => {
        expect(frame.contentWindow?.print).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:original');
        expect(frame.remove).toHaveBeenCalledOnce();
      });
  });

  it('shares the original file through the native file bridge', async () => {
    nativeMocks.isNative = true;

    await expect(
      PrintManager.original(new Blob(['original'], { type: 'application/pdf' }), 'Original PDF'),
    ).resolves.toBe(true);

    expect(nativeMocks.shareFile).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Original PDF',
        mimeType: 'application/pdf',
        data: 'b3JpZ2luYWw=',
      }),
    );
  });

  it('returns false when the EPUB print popup is blocked', async () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    await expect(
      PrintManager.epub(Promise.resolve(new Blob(['original'])), 'Original EPUB'),
    ).resolves.toBe(false);
  });

  it('prints every presentation slide as a separate A4 page', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, opener: undefined, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });
    const presentation = {
      outerHTML:
        '<div class="rich-document-renderer rich-pptx"><div class="rich-pptx__wrapper"><div class="rich-pptx__slide">1</div><div class="rich-pptx__slide">2</div></div></div>',
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    expect(PrintManager.presentation(presentation, 'Презентация')).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0] as string;
    expect(markup).toContain('@page { size: A4 landscape; margin: 20mm 15mm 20mm 30mm; }');
    expect(markup).toContain('break-after: page');
    expect(markup).toContain('<div class="rich-pptx__slide">1</div>');
    expect(markup).toContain('<div class="rich-pptx__slide">2</div>');
  });

  it('prints spreadsheets in A4 landscape orientation', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, opener: undefined, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });
    const spreadsheet = {
      outerHTML:
        '<div class="rich-document-renderer rich-sheet"><table><tr><td>Пневмония</td></tr></table></div>',
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    expect(PrintManager.element(spreadsheet, 'Таблица', { orientation: 'landscape' })).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0] as string;
    expect(markup).toContain('@page { size: A4 landscape; margin: 20mm 15mm 20mm 30mm; }');
    expect(markup).toContain('.rich-sheet__tabs { display: none');
    expect(markup).toContain('.rich-sheet__cell {');
  });

  it('returns false when printHtml popup is blocked', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    expect(PrintManager.html('<html></html>', 'Blocked')).toBe(false);
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
