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
