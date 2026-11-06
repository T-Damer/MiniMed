/**
 * A table the OCR of a scanned instruction could not rebuild (`review: table-candidate`): each
 * visual line keeps its cells apart with « | ». The rows cannot be repaired safely (multi-line cells,
 * page cuts), so the reader shows the lines as they were read — cells side by side, a line per row —
 * instead of raw pipes, and says the table comes from a scan.
 */
export interface OcrTable {
  /** Lines before the first row: the table's caption («Таблица 6. …»). */
  readonly caption: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** The widest row: the grid's column count. */
  readonly columns: number;
}

const CELL_SEPARATOR = /\s+\|\s+|\s*\|\|\s*/u;

export function isOcrTableChunk(
  text: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const review = metadata?.['review'];
  return Array.isArray(review) && review.includes('table-candidate') && / \| /u.test(text);
}

export function parseOcrTable(text: string): OcrTable {
  const caption: string[] = [];
  const rows: string[][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line
      .split(CELL_SEPARATOR)
      .map((cell) => cell.replace(/^\||\|$/gu, '').trim())
      .filter((cell) => cell.length > 0);
    if (cells.length > 1) rows.push(cells);
    else if (rows.length === 0) caption.push(line);
    else rows.push([line]);
  }
  return { caption, rows, columns: Math.max(1, ...rows.map((row) => row.length)) };
}
