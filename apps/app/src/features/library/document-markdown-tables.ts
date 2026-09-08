import type { DocumentTableBlock } from '@/features/library/document-rich-block-data';
import { markdownNodeText, parseMarkdownDocument } from '@/features/library/markdown-parser';

export function documentMarkdownTables(text: string): readonly {
  readonly start: number;
  readonly end: number;
  readonly table: DocumentTableBlock;
}[] {
  // Avoid parsing ordinary extracted prose as Markdown on every search/reader render.
  if (!text.includes('|') || !/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\||$)/mu.test(text)) return [];
  return parseMarkdownDocument(text).blocks.flatMap((node) => {
    if (node.type !== 'table') return [];
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    return [
      {
        start,
        end,
        table: {
          kind: 'table' as const,
          caption: '',
          rows: node.children.map((row, rowIndex) => ({
            cells: row.children.map((cell, column) => ({
              text: markdownNodeText(cell),
              header: rowIndex === 0,
              rowSpan: 1,
              colSpan: 1,
              images: [],
              ...(node.align?.[column] ? { align: node.align[column] } : {}),
            })),
          })),
        },
      },
    ];
  });
}
