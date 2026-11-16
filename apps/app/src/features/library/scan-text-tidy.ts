import type { MedicalChunk, MedicalDocument, MedicalSection } from '@localmed/contracts';

/**
 * What a reader is spared in a scanned instruction (owner 2026-11-16, after the audit of the
 * scans): chunks with no word in them, a sentence the scan printed twice in a row, and headings
 * that are a scrap of a stamp or a form («ИЛИ», «LLC»). Only the display changes: nothing is
 * reworded, the stored text, its checksum and its anchors stay as they are, and a document that is
 * not a scan (`metadata.ocr !== true`) is returned as it is.
 */

/** No word of three letters: «0 0 0 00000011», «(на». */
export function isContentFreeScanText(text: string): boolean {
  return !/\p{L}{3}/u.test(text);
}

const REPEAT_MIN = 25;
const REPEAT_MAX = 240;
const REPEAT = new RegExp(
  `(?<![\\p{L}\\p{N}])(.{${String(REPEAT_MIN)},${String(REPEAT_MAX)}}?)([\\s,;]+)\\1(?![\\p{L}\\p{N}])`,
  'gsu',
);

/**
 * «Не применять по истечении срока годности, Не применять по истечении срока годности, указанного
 * на упаковке» → one copy. Only an exact repeat of 25 characters or more, standing right after
 * itself.
 */
export function collapseScanRepeats(text: string): string {
  if (text.length < REPEAT_MIN * 2) return text;
  return text.replace(REPEAT, '$1');
}

/** A heading with fewer than four letters is not a heading: its text stays, under the one before. */
export function isScrapScanHeading(title: string): boolean {
  return (title.match(/\p{L}/gu)?.length ?? 0) < 4;
}

function tidyChunks(chunks: readonly MedicalChunk[]): readonly MedicalChunk[] {
  const kept: MedicalChunk[] = [];
  for (const chunk of chunks) {
    if (isContentFreeScanText(chunk.originalText)) continue;
    const text = collapseScanRepeats(chunk.originalText);
    kept.push(text === chunk.originalText ? chunk : { ...chunk, originalText: text });
  }
  return kept;
}

export function tidyScannedDocument(document: MedicalDocument): MedicalDocument {
  if (document.metadata['ocr'] !== true) return document;
  const sections: MedicalSection[] = [];
  for (const section of document.sections) {
    const chunks = tidyChunks(section.chunks);
    const previous = sections.at(-1);
    // A scrap heading: its chunks join the section above (the first section keeps its place).
    if (previous && isScrapScanHeading(section.title)) {
      sections[sections.length - 1] = { ...previous, chunks: [...previous.chunks, ...chunks] };
      continue;
    }
    // A section left with nothing to read is not listed.
    if (chunks.length === 0 && section.chunks.length > 0) continue;
    sections.push(chunks === section.chunks ? section : { ...section, chunks });
  }
  return { ...document, sections };
}
