import { describe, expect, it } from 'vitest';
import {
  documentRenderBlockSearchText,
  readDocumentRenderBlock,
  resolveDocumentChunkItems,
  usableImageLabel,
} from '@/features/library/document-rich-block-data';

describe('readDocumentRenderBlock', () => {
  it('accepts structured tables and safe embedded images', () => {
    expect(
      readDocumentRenderBlock({
        renderBlock: {
          kind: 'table',
          caption: 'Показатели',
          rows: [
            {
              cells: [
                { text: 'Возраст', header: true, rowSpan: 2, colSpan: 1 },
                {
                  text: 'Значение',
                  header: false,
                  rowSpan: 1,
                  colSpan: 2,
                  images: [
                    {
                      kind: 'image',
                      dataUrl: 'data:image/png;base64,AAAA',
                      alt: 'Схема в ячейке',
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      kind: 'table',
      caption: 'Показатели',
      rows: [{ cells: [{ images: [] }, { images: [{ alt: 'Схема в ячейке' }] }] }],
    });

    expect(
      readDocumentRenderBlock({
        renderBlock: {
          kind: 'image',
          dataUrl: 'data:image/png;base64,AAAA',
          alt: 'Схема',
          title: '',
        },
      }),
    ).toMatchObject({ kind: 'image', alt: 'Схема' });
  });

  it('rejects remote images and malformed table spans', () => {
    expect(
      readDocumentRenderBlock({
        renderBlock: { kind: 'image', dataUrl: 'https://example.test/image.png' },
      }),
    ).toBeNull();
    expect(
      readDocumentRenderBlock({
        renderBlock: {
          kind: 'table',
          rows: [{ cells: [{ text: 'bad', rowSpan: 0, colSpan: 1 }] }],
        },
      }),
    ).toBeNull();
  });

  it('hides filename alts and attaches a nearby Рис. caption', () => {
    expect(usableImageLabel('image.png')).toBe('');
    expect(usableImageLabel('Рис. 1. Схема')).toBe('Рис. 1. Схема');

    const items = resolveDocumentChunkItems([
      {
        id: 'image',
        sectionId: 's1',
        documentVersionId: 'v1',
        orderIndex: 0,
        originalText: 'image.png',
        pageStart: null,
        pageEnd: null,
        anchor: 'image',
        metadata: {
          renderBlock: {
            kind: 'image',
            dataUrl: 'data:image/png;base64,AAAA',
            alt: 'image.png',
            title: '',
          },
        },
      },
      {
        id: 'caption',
        sectionId: 's1',
        documentVersionId: 'v1',
        orderIndex: 1,
        originalText: 'Рис. 1. Активность ПМП против штаммов S. pneumoniae в РФ (n=540)',
        pageStart: null,
        pageEnd: null,
        anchor: 'caption',
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'rich',
      block: {
        kind: 'image',
        title: 'Рис. 1. Активность ПМП против штаммов S. pneumoniae в РФ (n=540)',
      },
    });
  });

  it('builds find text in the same order as the visible rich block', () => {
    expect(
      documentRenderBlockSearchText({
        kind: 'table',
        caption: 'Показатели',
        rows: [
          {
            cells: [{ text: 'Возраст', header: true, rowSpan: 1, colSpan: 1, images: [] }],
          },
        ],
      }),
    ).toBe('Показатели\nВозраст');
  });
});

describe('regulatory act tables', () => {
  // The shape written by the legal-text assembler (tools/ingest legal_texts.render_table): no caption,
  // a header row, blank continuation cells, line breaks inside a cell kept as newlines.
  const table = {
    renderBlock: {
      kind: 'table',
      caption: '',
      rows: [
        {
          cells: [
            { text: '№ п/п', header: true, rowSpan: 1, colSpan: 1 },
            { text: 'Код вида медицинского изделия', header: true, rowSpan: 1, colSpan: 1 },
            { text: 'Требуемое количество, штук', header: true, rowSpan: 1, colSpan: 1 },
          ],
        },
        {
          cells: [
            { text: '1.', header: false, rowSpan: 1, colSpan: 1 },
            { text: '187150', header: false, rowSpan: 1, colSpan: 1 },
            { text: '1', header: false, rowSpan: 1, colSpan: 1 },
          ],
        },
        {
          cells: [
            { text: '', header: false, rowSpan: 1, colSpan: 1 },
            { text: 'Стол\nдля осмотра', header: false, rowSpan: 1, colSpan: 1 },
            { text: '', header: false, rowSpan: 1, colSpan: 1 },
          ],
        },
      ],
    },
  };

  it('reads the table the assembler writes, keeping every row and cell', () => {
    const block = readDocumentRenderBlock(table);
    expect(block?.kind).toBe('table');
    if (block?.kind !== 'table') return;
    expect(block.rows).toHaveLength(3);
    expect(block.rows.every((row) => row.cells.length === 3)).toBe(true);
    expect(block.rows[0]?.cells.every((cell) => cell.header)).toBe(true);
    expect(block.rows[2]?.cells[1]?.text).toBe('Стол\nдля осмотра');
  });

  it('finds an equipment code inside a table cell', () => {
    const block = readDocumentRenderBlock(table);
    expect(block).not.toBeNull();
    if (!block) return;
    expect(documentRenderBlockSearchText(block)).toContain('187150');
  });
});
