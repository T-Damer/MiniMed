import { describe, expect, it } from 'vitest';
import { readDocumentRenderBlock } from '@/features/library/document-rich-block-data';

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
});
