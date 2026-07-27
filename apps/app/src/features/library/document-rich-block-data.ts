export interface DocumentImageBlock {
  readonly kind: 'image';
  readonly dataUrl: string;
  readonly alt: string;
  readonly title: string;
}

export interface DocumentTableCell {
  readonly text: string;
  readonly header: boolean;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly images: readonly DocumentImageBlock[];
}

export interface DocumentTableRow {
  readonly cells: readonly DocumentTableCell[];
}

export interface DocumentTableBlock {
  readonly kind: 'table';
  readonly caption: string;
  readonly rows: readonly DocumentTableRow[];
}

export type DocumentRenderBlock = DocumentTableBlock | DocumentImageBlock;

const SAFE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/u;

function span(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : null;
}

function readImage(value: Readonly<Record<string, unknown>>): DocumentImageBlock | null {
  if (
    value['kind'] !== 'image' ||
    typeof value['dataUrl'] !== 'string' ||
    !SAFE_IMAGE.test(value['dataUrl'])
  ) {
    return null;
  }
  return {
    kind: 'image',
    dataUrl: value['dataUrl'],
    alt: typeof value['alt'] === 'string' ? value['alt'] : '',
    title: typeof value['title'] === 'string' ? value['title'] : '',
  };
}

function readTable(value: Readonly<Record<string, unknown>>): DocumentTableBlock | null {
  if (!Array.isArray(value['rows'])) return null;
  const rows: DocumentTableRow[] = [];
  for (const rawRow of value['rows']) {
    if (!rawRow || typeof rawRow !== 'object') return null;
    const cellsValue = (rawRow as Readonly<Record<string, unknown>>)['cells'];
    if (!Array.isArray(cellsValue)) return null;
    const cells: DocumentTableCell[] = [];
    for (const rawCell of cellsValue) {
      if (!rawCell || typeof rawCell !== 'object') return null;
      const cell = rawCell as Readonly<Record<string, unknown>>;
      const rowSpan = span(cell['rowSpan']);
      const colSpan = span(cell['colSpan']);
      if (typeof cell['text'] !== 'string' || rowSpan === null || colSpan === null) return null;
      const images = Array.isArray(cell['images'])
        ? cell['images']
            .filter((image): image is Readonly<Record<string, unknown>> =>
              Boolean(image && typeof image === 'object'),
            )
            .map(readImage)
            .filter((image): image is DocumentImageBlock => image !== null)
        : [];
      cells.push({
        text: cell['text'],
        header: cell['header'] === true,
        rowSpan,
        colSpan,
        images,
      });
    }
    if (cells.length > 0) rows.push({ cells });
  }
  if (rows.length === 0) return null;
  return {
    kind: 'table',
    caption: typeof value['caption'] === 'string' ? value['caption'] : '',
    rows,
  };
}

export function readDocumentRenderBlock(
  metadata: Readonly<Record<string, unknown>> | undefined,
): DocumentRenderBlock | null {
  const value = metadata?.['renderBlock'];
  if (!value || typeof value !== 'object') return null;
  const block = value as Readonly<Record<string, unknown>>;
  if (block['kind'] === 'table') return readTable(block);
  return readImage(block);
}
