/**
 * A real multi-page PDF built in memory (Helvetica, Latin text only, so no font embedding), for the
 * PDF viewer specs and the phone-performance measurement.
 */

export interface SyntheticPdfOptions {
  readonly pages: number;
  /** Text lines of a 0-based page. */
  readonly lines?: (pageIndex: number) => readonly string[];
  /** Page size in points; default A4. */
  readonly size?: (pageIndex: number) => readonly [number, number];
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function defaultLines(pageIndex: number): readonly string[] {
  const number = pageIndex + 1;
  return [
    `Chapter ${String(Math.ceil(number / 5))} - page ${String(number)}`,
    `Marker ${String(number)} alpha-${String(number)}-omega`,
    number % 7 === 0 ? 'Arterial hypertension in adults' : 'Routine follow-up notes',
    number % 7 === 0 ? 'was reviewed again on this page.' : 'continue on the next page.',
  ];
}

export function syntheticPdf(options: SyntheticPdfOptions): Buffer {
  const lines = options.lines ?? defaultLines;
  const size = options.size ?? (() => [595, 842] as const);
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 font, then per page: page object and content stream.
  const pageObjectNumber = (index: number): number => 4 + index * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = Array.from(
    { length: options.pages },
    (_, index) => `${String(pageObjectNumber(index))} 0 R`,
  ).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${String(options.pages)} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let index = 0; index < options.pages; index += 1) {
    const [width, height] = size(index);
    const pageNumber = pageObjectNumber(index);
    const streamNumber = pageNumber + 1;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${String(streamNumber)} 0 R >>`;
    const body = lines(index)
      .map((line, lineIndex) => {
        const y = height - 72 - lineIndex * 18;
        return `BT /F1 12 Tf 72 ${String(y)} Td (${escapePdfText(line)}) Tj ET`;
      })
      .join('\n');
    objects[streamNumber] =
      `<< /Length ${String(Buffer.byteLength(body, 'latin1'))} >>\nstream\n${body}\nendstream`;
  }

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    const object = objects[number];
    if (object === undefined) continue;
    offsets[number] = Buffer.byteLength(output, 'latin1');
    output += `${String(number)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    output += `${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
