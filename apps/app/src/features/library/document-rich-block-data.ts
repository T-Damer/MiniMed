import type { MedicalChunk } from '@localmed/contracts';

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

export type DocumentChunkRenderItem =
  | { readonly kind: 'rich'; readonly chunk: MedicalChunk; readonly block: DocumentRenderBlock }
  | { readonly kind: 'text'; readonly chunk: MedicalChunk };

const SAFE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/u;
const FILENAME_LABEL = /^(?:[a-z0-9][a-z0-9._-]*)\.(?:png|jpe?g|gif|webp|bmp|svg)$/iu;
const FIGURE_CAPTION = /^(рис(?:унок)?|fig(?:ure)?|табл(?:ица)?)\.?\s*\d+/iu;

export function usableImageLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || FILENAME_LABEL.test(trimmed)) return '';
  return trimmed;
}

export function isFigureCaptionText(value: string): boolean {
  return FIGURE_CAPTION.test(value.trim());
}

export function visibleImageCaption(alt: string, title?: string): string {
  return usableImageLabel(title ?? '') || usableImageLabel(alt);
}

export function documentRenderBlockSearchText(block: DocumentRenderBlock): string {
  if (block.kind === 'image') return visibleImageCaption(block.alt, block.title);
  const cells = block.rows.flatMap((row) => row.cells.map((cell) => cell.text));
  return (block.caption ? [block.caption, ...cells] : cells).join('\n');
}

function span(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : null;
}

function readImage(value: Readonly<Record<string, unknown>>): DocumentImageBlock | null {
  const dataUrl = value['dataUrl'];
  if (value['kind'] !== 'image' || typeof dataUrl !== 'string' || !SAFE_IMAGE.test(dataUrl)) {
    return null;
  }
  const alt = value['alt'];
  const title = value['title'];
  return {
    kind: 'image',
    dataUrl,
    alt: usableImageLabel(typeof alt === 'string' ? alt : ''),
    title: usableImageLabel(typeof title === 'string' ? title : ''),
  };
}

function readTable(value: Readonly<Record<string, unknown>>): DocumentTableBlock | null {
  const rawRows = value['rows'];
  if (!Array.isArray(rawRows)) return null;
  const rows: DocumentTableRow[] = [];
  for (const rawRow of rawRows) {
    if (!rawRow || typeof rawRow !== 'object') return null;
    const cellsValue = (rawRow as Readonly<Record<string, unknown>>)['cells'];
    if (!Array.isArray(cellsValue)) return null;
    const cells: DocumentTableCell[] = [];
    for (const rawCell of cellsValue) {
      if (!rawCell || typeof rawCell !== 'object') return null;
      const cell = rawCell as Readonly<Record<string, unknown>>;
      const rowSpan = span(cell['rowSpan']);
      const colSpan = span(cell['colSpan']);
      const text = cell['text'];
      if (typeof text !== 'string' || rowSpan === null || colSpan === null) return null;
      const rawImages = cell['images'];
      const images = Array.isArray(rawImages)
        ? rawImages
            .filter((image): image is Readonly<Record<string, unknown>> =>
              Boolean(image && typeof image === 'object'),
            )
            .map(readImage)
            .filter((image): image is DocumentImageBlock => image !== null)
        : [];
      cells.push({
        text,
        header: cell['header'] === true,
        rowSpan,
        colSpan,
        images,
      });
    }
    if (cells.length > 0) rows.push({ cells });
  }
  if (rows.length === 0) return null;
  const caption = value['caption'];
  return {
    kind: 'table',
    caption: typeof caption === 'string' ? caption : '',
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

function blockNeedsCaption(block: DocumentRenderBlock): boolean {
  if (block.kind === 'image') return !visibleImageCaption(block.alt, block.title);
  return block.caption.trim().length === 0;
}

function withCaption(block: DocumentRenderBlock, caption: string): DocumentRenderBlock {
  if (block.kind === 'image') {
    return { ...block, title: caption, alt: visibleImageCaption(block.alt) || caption };
  }
  return { ...block, caption };
}

export function resolveDocumentChunkItems(
  chunks: readonly MedicalChunk[],
): readonly DocumentChunkRenderItem[] {
  const consumed = new Set<number>();
  const resolved = chunks.map((chunk) => ({
    chunk,
    block: readDocumentRenderBlock(chunk.metadata),
  }));

  for (const [index, item] of resolved.entries()) {
    if (!item.block || !blockNeedsCaption(item.block)) continue;
    for (const neighbor of [index + 1, index - 1]) {
      const candidate = resolved[neighbor];
      if (neighbor < 0 || neighbor >= resolved.length || consumed.has(neighbor) || !candidate) {
        continue;
      }
      if (candidate.block || !isFigureCaptionText(candidate.chunk.originalText)) continue;
      resolved[index] = {
        ...item,
        block: withCaption(item.block, candidate.chunk.originalText.trim()),
      };
      consumed.add(neighbor);
      break;
    }
  }

  return resolved.flatMap((item, index): DocumentChunkRenderItem[] => {
    if (consumed.has(index)) return [];
    if (item.block) return [{ kind: 'rich', chunk: item.chunk, block: item.block }];
    return [{ kind: 'text', chunk: item.chunk }];
  });
}
