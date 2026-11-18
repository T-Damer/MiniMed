/** The printable area on A4 after the document print margins, in CSS pixels. */
export const PRINT_DOCUMENT_BODY_HEIGHT = (257 * 96) / 25.4;
export const PRINT_DOCUMENT_PAGE_WIDTH = (210 * 96) / 25.4;

function blockHeight(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.getBoundingClientRect().height +
    Number.parseFloat(style.marginTop) +
    Number.parseFloat(style.marginBottom)
  );
}

interface PrintBlock {
  readonly element: HTMLElement;
  readonly height: number;
}

/** Repeat the heading when a table spans preview sheets. Row spans keep their rows together. */
function tableBlocks(table: HTMLTableElement, height: number): readonly PrintBlock[] {
  if (height <= PRINT_DOCUMENT_BODY_HEIGHT || table.tBodies.length !== 1) {
    return [{ element: table, height }];
  }
  const rows = Array.from(table.tBodies[0]?.rows ?? []);
  if (rows.length === 0) return [{ element: table, height }];
  const rowHeights = rows.map((row) => row.getBoundingClientRect().height);
  const leadingHeight = height - rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0);
  const blocks: PrintBlock[] = [];
  let pending: HTMLTableRowElement[] = [];
  let pendingHeight = leadingHeight;
  let spanEnd = 0;
  const flush = (): void => {
    if (pending.length === 0) return;
    const fragment = table.cloneNode(false) as HTMLTableElement;
    if (!blocks.length && table.caption) fragment.append(table.caption.cloneNode(true));
    if (table.tHead) fragment.append(table.tHead.cloneNode(true));
    fragment.createTBody().append(...pending);
    blocks.push({ element: fragment, height: pendingHeight });
    pending = [];
    pendingHeight = leadingHeight;
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const rowHeight = rowHeights[index] ?? 0;
    if (index >= spanEnd && pendingHeight + rowHeight > PRINT_DOCUMENT_BODY_HEIGHT) flush();
    for (const cell of Array.from(row.cells)) {
      spanEnd = Math.max(spanEnd, cell.rowSpan === 0 ? rows.length : index + cell.rowSpan);
    }
    pending.push(row);
    pendingHeight += rowHeight;
  }
  flush();
  return blocks;
}

export interface DocumentPreviewPage {
  readonly content: DocumentFragment;
  readonly overflow: number;
}

/** Split a laid out print document at block boundaries, keeping its reconstructed cover separate. */
export function documentPreviewPages(root: HTMLElement): readonly DocumentPreviewPage[] {
  const elements = Array.from(root.children)
    .flatMap((element) =>
      element.classList.contains('doc-print__section') ? Array.from(element.children) : [element],
    )
    .filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.tagName !== 'STYLE',
    );
  const measured = elements.map((element) => ({ element, height: blockHeight(element) }));
  const blocks = measured.flatMap((block) =>
    block.element instanceof HTMLTableElement ? tableBlocks(block.element, block.height) : [block],
  );
  const pages: DocumentPreviewPage[] = [];
  let content = document.createDocumentFragment();
  let height = 0;
  const flush = (): void => {
    if (!content.childElementCount) return;
    pages.push({ content, overflow: Math.max(0, height - PRINT_DOCUMENT_BODY_HEIGHT) });
    content = document.createDocumentFragment();
    height = 0;
  };
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const cover = block.element.classList.contains('doc-print__cover');
    const following = block.element.classList.contains('doc-print__heading')
      ? Math.min(blocks[index + 1]?.height ?? 0, 92)
      : 0;
    if (cover || height + block.height + following > PRINT_DOCUMENT_BODY_HEIGHT) flush();
    content.append(block.element);
    height += block.height;
    if (cover) flush();
  }
  flush();
  return pages;
}
