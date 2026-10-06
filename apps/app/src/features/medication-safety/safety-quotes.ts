/**
 * Reads the sentences the safety index points at from an installed instruction (SAFE1). The index
 * holds offsets only; the text is the instruction's own, quoted without change. A long sentence (a
 * contraindication list of eight hundred characters) is cut to the list items around the words that
 * made it a hit, with «…» where it was cut; the cut is a plain substring of the sentence, nothing is
 * rewritten. Every quote carries the anchor of the chunk it starts in, so the reader can open at that
 * place. A section whose text is not the text the index was built from (another edition) is
 * reported, never guessed at.
 */
import type { MedicalDocument, MedicalSection } from '@localmed/contracts';

import {
  canonicalSectionText,
  chunkIndexAt,
  sectionChecksum,
} from '@/features/drug-interactions/interaction-text';
import { SECTION_CHECKSUM_LENGTH } from './safety-index';

export interface QuoteSegment {
  readonly text: string;
  readonly hit: boolean;
}

export interface SafetyQuote {
  readonly key: string;
  /** The words of each hit range, as the instruction prints them (whitespace collapsed). */
  readonly hitTexts: readonly string[];
  /** The words shown, with the hit words marked. */
  readonly segments: readonly QuoteSegment[];
  /** The whole sentence as one line, for print and share. */
  readonly fullText: string;
  readonly cutBefore: boolean;
  readonly cutAfter: boolean;
  /** Anchor of the chunk the sentence starts in, for the reader. */
  readonly anchor: string | null;
  readonly sectionTitle: string;
}

export interface ResolvedQuotes {
  readonly quotes: readonly (SafetyQuote & {
    readonly flags: number;
    readonly sourceIndex: number;
  })[];
  /** Sentences whose section is not the text the index was built from. */
  readonly changed: number;
}

export interface QuoteRequest {
  readonly section: readonly [string, string];
  readonly start: number;
  readonly end: number;
  readonly flags: number;
  /**
   * Ranges to mark and to centre the cut on, as offsets in the sentence text it is given (the
   * sentence as written in the section, line breaks included).
   */
  readonly hits: (sentence: string) => readonly (readonly [number, number])[];
}

/** A sentence longer than this is cut around its hits. */
export const MAX_FULL_QUOTE = 420;
const CONTEXT_BEFORE = 150;
const CONTEXT_AFTER = 150;
const SNAP_DISTANCE = 120;
/** A dash that opens a list item inside running text: «… - Беременность - Период …». */
const INLINE_DASH = /^[-–—−─]$/u;
const BULLET_AFTER_BREAK = /^\s*[-–—•·*−●▪]\s/u;

function sectionChunks(section: MedicalSection): readonly MedicalSection['chunks'][number][] {
  return section.chunks.toSorted((left, right) => left.orderIndex - right.orderIndex);
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ');
}

/** The nearest place at or before `position` that opens a list item or a clause. */
function snapLeft(text: string, position: number, floor: number): number {
  const lowest = Math.max(floor, position - SNAP_DISTANCE);
  for (let at = position; at > lowest; at -= 1) {
    const before = text.charAt(at - 1);
    if (before === ';' || before === '•') return at;
    if (before === '\n' && BULLET_AFTER_BREAK.test(text.slice(at, at + 4))) return at;
    if (
      INLINE_DASH.test(before) &&
      /\s/u.test(text.charAt(at)) &&
      /\s/u.test(text.charAt(at - 2))
    ) {
      return at;
    }
  }
  for (let at = position; at > floor; at -= 1) {
    if (/\s/u.test(text.charAt(at - 1))) return at;
  }
  return floor;
}

/** The nearest place at or after `position` that ends a list item or a clause. */
function snapRight(text: string, position: number, ceiling: number): number {
  const highest = Math.min(ceiling, position + SNAP_DISTANCE);
  for (let at = position; at < highest; at += 1) {
    const here = text.charAt(at);
    if (here === ';') return at + 1;
    if (
      INLINE_DASH.test(here) &&
      /\s/u.test(text.charAt(at - 1)) &&
      /\s/u.test(text.charAt(at + 1))
    ) {
      return at - 1;
    }
    if (here === '\n' && BULLET_AFTER_BREAK.test(text.slice(at + 1, at + 5))) return at;
  }
  for (let at = position; at < ceiling; at += 1) {
    if (/\s/u.test(text.charAt(at))) return at;
  }
  return ceiling;
}

function segmentsOf(
  text: string,
  from: number,
  to: number,
  hits: readonly (readonly [number, number])[],
): readonly QuoteSegment[] {
  const inside = hits
    .map(([start, end]) => [Math.max(start, from), Math.min(end, to)] as const)
    .filter(([start, end]) => end > start)
    .toSorted((left, right) => left[0] - right[0]);
  const segments: QuoteSegment[] = [];
  let cursor = from;
  for (const [start, end] of inside) {
    if (start < cursor) continue;
    if (start > cursor) segments.push({ text: collapse(text.slice(cursor, start)), hit: false });
    segments.push({ text: collapse(text.slice(start, end)), hit: true });
    cursor = end;
  }
  if (cursor < to) segments.push({ text: collapse(text.slice(cursor, to)), hit: false });
  const cleaned = segments.filter((segment) => segment.text !== '');
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first) cleaned[0] = { ...first, text: first.text.trimStart() };
  if (last) cleaned[cleaned.length - 1] = { ...last, text: last.text.trimEnd() };
  return cleaned;
}

export function resolveSafetyQuotes(
  document: MedicalDocument,
  requests: readonly QuoteRequest[],
): ResolvedQuotes {
  const sections = new Map(document.sections.map((section) => [section.id, section]));
  const canonical = new Map<
    string,
    {
      text: string;
      chunkStarts: readonly number[];
      chunks: readonly { anchor: string }[];
      valid: boolean;
    }
  >();
  const quotes: (SafetyQuote & { flags: number; sourceIndex: number })[] = [];
  let changed = 0;
  requests.forEach((request, sourceIndex) => {
    const [sectionId, checksum] = request.section;
    let entry = canonical.get(sectionId);
    if (!entry) {
      const section = sections.get(sectionId);
      if (!section) {
        entry = { text: '', chunkStarts: [], chunks: [], valid: false };
      } else {
        const chunks = sectionChunks(section);
        const built = canonicalSectionText(chunks.map((chunk) => chunk.originalText));
        entry = {
          text: built.text,
          chunkStarts: built.chunkStarts,
          chunks,
          valid: sectionChecksum(built.text).startsWith(checksum.slice(0, SECTION_CHECKSUM_LENGTH)),
        };
      }
      canonical.set(sectionId, entry);
    }
    if (!entry.valid || request.end > entry.text.length) {
      changed += 1;
      return;
    }
    const { text } = entry;
    const fullText = collapse(text.slice(request.start, request.end)).trim();
    const hits = request
      .hits(text.slice(request.start, request.end))
      .map(([start, end]) => [request.start + start, request.start + end] as const);
    let from = request.start;
    let to = request.end;
    if (request.end - request.start > MAX_FULL_QUOTE && hits.length > 0) {
      const first = Math.min(...hits.map((hit) => hit[0]));
      const last = Math.max(...hits.map((hit) => hit[1]));
      from = snapLeft(text, Math.max(request.start, first - CONTEXT_BEFORE), request.start);
      to = snapRight(text, Math.min(request.end, last + CONTEXT_AFTER), request.end);
      if (from > first) from = request.start;
      if (to < last) to = request.end;
    }
    const chunk = entry.chunks[chunkIndexAt(entry.chunkStarts, request.start)];
    quotes.push({
      key: `${sectionId}:${request.start}`,
      hitTexts: hits.map(([start, end]) => collapse(text.slice(start, end)).trim()),
      segments: segmentsOf(text, from, to, hits),
      fullText,
      cutBefore: from > request.start,
      cutAfter: to < request.end,
      anchor: chunk?.anchor ?? null,
      sectionTitle: sections.get(sectionId)?.title ?? '',
      flags: request.flags,
      sourceIndex,
    });
  });
  return { quotes, changed };
}
