import type { MedicalChunk, MedicalSection } from '@localmed/contracts';

import { readDocumentRenderBlock } from '@/features/library/document-rich-block-data';
import { type NumberedHeading, parseNumberedHeading } from '@/features/library/numbered-headings';

/**
 * Reader-side sections for the numbered sub-headings a clinical recommendation kept as paragraphs
 * («3.2.1 Заголовок»). A heading paragraph becomes a real section of the reader (outline entry,
 * heading element, find unit, copyable link) and the text after it moves into that section.
 *
 * Nothing stored changes. Existing sections keep their ids and anchors; a chunk without such a
 * heading is passed through as the same object; a chunk that holds one is cut at the heading, the
 * first piece that has text keeps the chunk's id and anchor (so a link to the chunk still lands on
 * its text) and the later pieces get derived ids (`<chunk id>~<n>`). Headings get `<chunk
 * anchor>~h<n>`.
 */

const BLANK_LINE_SEPARATOR = /\r?\n(?:[ \t]*\r?\n)+/gu;
const POSSIBLE_HEADING = /^\s*\d{1,2}\.\d/u;

export function isClinicalRecommendationSource(sourceType: string): boolean {
  return sourceType.startsWith('clinical_recommendation');
}

interface TextSegment {
  readonly start: number;
  readonly end: number;
}

/** Blank-line separated blocks of `text`, as ranges into it (the split `DocumentText` starts with). */
function segmentRanges(text: string): readonly TextSegment[] {
  const segments: TextSegment[] = [];
  let start = 0;
  for (const separator of text.matchAll(BLANK_LINE_SEPARATOR)) {
    segments.push({ start, end: separator.index });
    start = separator.index + separator[0].length;
  }
  segments.push({ start, end: text.length });
  return segments;
}

interface HeadingAt {
  readonly segment: number;
  readonly heading: NumberedHeading;
  readonly line: string;
}

function headingsIn(text: string, segments: readonly TextSegment[]): readonly HeadingAt[] {
  const found: HeadingAt[] = [];
  for (const [index, range] of segments.entries()) {
    const line = text.slice(range.start, range.end).trim();
    if (!POSSIBLE_HEADING.test(line)) continue;
    const heading = parseNumberedHeading(line);
    if (heading) found.push({ segment: index, heading, line });
  }
  return found;
}

function pieceMetadata(
  chunk: MedicalChunk,
  segments: readonly TextSegment[],
  from: number,
  to: number,
): MedicalChunk['metadata'] {
  // biome-ignore lint/complexity/useLiteralKeys: source spans are optional runtime metadata.
  const spans = chunk.metadata?.['sourceSpans'];
  if (!Array.isArray(spans) || spans.length !== segments.length) return chunk.metadata;
  return { ...chunk.metadata, sourceSpans: spans.slice(from, to) };
}

function pieceText(text: string, segments: readonly TextSegment[], from: number, to: number) {
  const first = segments[from];
  const last = segments[to - 1];
  if (!first || !last || to <= from) return '';
  return text.slice(first.start, last.end);
}

interface Builder {
  readonly section: Omit<MedicalSection, 'chunks'>;
  readonly chunks: MedicalChunk[];
  /** The stored section this builder continues; reused as is when its chunks did not change. */
  readonly original?: MedicalSection;
}

function headingSection(
  source: MedicalSection,
  chunk: MedicalChunk,
  at: HeadingAt,
  ordinal: number,
  parentPath: readonly string[],
  parentId: string | null,
): Builder {
  return {
    section: {
      id: `${chunk.id}~h${String(ordinal)}`,
      documentVersionId: source.documentVersionId,
      parentSectionId: parentId,
      title: at.line,
      sectionType: source.sectionType,
      depth: at.heading.depth,
      orderIndex: chunk.orderIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      anchor: `${chunk.anchor}~h${String(ordinal)}`,
      sectionPath: [...parentPath, at.line],
    },
    chunks: [],
  };
}

/**
 * `sections` in reading order with the numbered heading paragraphs of their text turned into
 * sections of their own. Sections without such a paragraph are returned as they are.
 */
export function promoteNumberedHeadingSections(
  sections: readonly MedicalSection[],
): readonly MedicalSection[] {
  const builders: Builder[] = [];
  // Nearest earlier section per depth, to give a promoted heading its parent and path.
  const stack: Array<{ depth: number; id: string; path: readonly string[] }> = [];
  const push = (builder: Builder): void => {
    builders.push(builder);
    const { depth, id, sectionPath } = builder.section;
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop();
    stack.push({ depth, id, path: sectionPath });
  };
  let changed = false;

  for (const section of sections) {
    let current: Builder = { section, chunks: [], original: section };
    push(current);
    for (const chunk of section.chunks) {
      if (readDocumentRenderBlock(chunk.metadata) !== null || !/\d\.\d/u.test(chunk.originalText)) {
        current.chunks.push(chunk);
        continue;
      }
      const text = chunk.originalText;
      const segments = segmentRanges(text);
      const headings = headingsIn(text, segments);
      if (headings.length === 0) {
        current.chunks.push(chunk);
        continue;
      }
      changed = true;
      const firstHeading = headings[0];
      const leadText = pieceText(text, segments, 0, firstHeading?.segment ?? 0);
      if (leadText.trim().length > 0) {
        current.chunks.push({
          ...chunk,
          originalText: leadText,
          ...optionalMetadata(pieceMetadata(chunk, segments, 0, firstHeading?.segment ?? 0)),
        });
      }
      for (const [ordinal, at] of headings.entries()) {
        const parent = (() => {
          for (let index = stack.length - 1; index >= 0; index -= 1) {
            const candidate = stack[index];
            if (candidate && candidate.depth < at.heading.depth) return candidate;
          }
          return undefined;
        })();
        current = headingSection(
          section,
          chunk,
          at,
          ordinal,
          parent?.path ?? [],
          parent?.id ?? null,
        );
        push(current);
        const end = headings[ordinal + 1]?.segment ?? segments.length;
        const bodyText = pieceText(text, segments, at.segment + 1, end);
        if (bodyText.trim().length === 0) continue;
        const keepsChunkIdentity = ordinal === 0 && leadText.trim().length === 0;
        current.chunks.push({
          ...chunk,
          id: keepsChunkIdentity ? chunk.id : `${chunk.id}~${String(ordinal)}`,
          anchor: keepsChunkIdentity ? chunk.anchor : `${chunk.anchor}~${String(ordinal)}`,
          originalText: bodyText,
          ...optionalMetadata(pieceMetadata(chunk, segments, at.segment + 1, end)),
        });
      }
    }
  }

  if (!changed) return sections;
  return builders.map(({ section, chunks, original }) =>
    original &&
    original.chunks.length === chunks.length &&
    original.chunks.every((chunk, index) => chunk === chunks[index])
      ? original
      : { ...section, chunks },
  );
}

type ChunkMetadata = Readonly<Record<string, unknown>>;

function optionalMetadata(metadata: ChunkMetadata | undefined): { metadata?: ChunkMetadata } {
  return metadata === undefined ? {} : { metadata };
}
